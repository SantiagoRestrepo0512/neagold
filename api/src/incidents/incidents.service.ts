import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common'
import { IncidentStatus, IncidentType, PieceStatus, Prisma } from '@prisma/client'
import { AuditAction, AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import { EventsService } from '../events/events.service'
import { nextYear } from '../common/utils/tokens'
import { AddIncidentReportDto } from './dto/add-incident-report.dto'
import { CreateIncidentDto } from './dto/create-incident.dto'

/** Estados de incidente que impiden transferir/vender la pieza. */
const OPEN_INCIDENT_STATUSES: IncidentStatus[] = ['ACTIVE', 'UNDER_REVIEW']

/** Tipo de incidente → estado que adquiere la pieza (null: sin cambio). */
const PIECE_STATUS_BY_TYPE: Partial<Record<IncidentType, PieceStatus>> = {
  STOLEN: 'REPORTED_STOLEN',
  LOST: 'LOST'
}

const INCIDENT_DETAIL_INCLUDE = {
  piece: {
    select: { id: true, internalId: true, serialNumber: true, publicId: true, status: true }
  },
  reporter: { select: { id: true, email: true, firstName: true, lastName: true } },
  reports: {
    orderBy: { createdAt: 'desc' as const },
    include: { reporter: { select: { id: true, firstName: true, lastName: true } } }
  }
} satisfies Prisma.incidentsInclude

type IncidentDetail = Prisma.incidentsGetPayload<{ include: typeof INCIDENT_DETAIL_INCLUDE }>

export interface IncidentListQuery {
  type?: IncidentType
  status?: IncidentStatus
  limit: number
  offset: number
}

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

@Injectable()
export class IncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventsService
  ) {}

  /**
   * Reporte de robo/pérdida: solo el propietario activo de la pieza (o staff
   * en su nombre). Marca la pieza REPORTED_STOLEN/LOST y crea el incidente
   * con su primer reporte. Una pieza no puede tener dos incidentes abiertos.
   */
  async report(dto: CreateIncidentDto, actor: { id: string; permissions: string[] }) {
    const piece = await this.prisma.jewelry_pieces.findUnique({ where: { id: dto.pieceId } })
    if (!piece) throw new NotFoundException('Pieza no encontrada')
    if (piece.status === 'RETIRED') {
      throw new BadRequestException('No se puede reportar un incidente sobre una pieza retirada')
    }

    const activeOwner = await this.prisma.ownership_records.findFirst({
      where: { pieceId: piece.id, endDate: null }
    })
    const isStaff = actor.permissions.includes('incidents:create') && actor.permissions.includes('incidents:read')
    if (!activeOwner && !isStaff) {
      throw new ForbiddenException('Solo el propietario de la pieza puede reportar un incidente')
    }
    if (activeOwner && activeOwner.ownerId !== actor.id && !isStaff) {
      throw new ForbiddenException('Solo el propietario de la pieza puede reportar un incidente')
    }

    const activeIncident = await this.prisma.incidents.findFirst({
      where: { pieceId: piece.id, status: { in: OPEN_INCIDENT_STATUSES } }
    })
    if (activeIncident) {
      throw new ConflictException('La pieza ya tiene un incidente abierto')
    }

    const pieceStatus = PIECE_STATUS_BY_TYPE[dto.type] ?? null

    try {
      const incident = await this.prisma.$transaction(async (tx) => {
        const incident = await tx.incidents.create({
          data: {
            pieceId: piece.id,
            type: dto.type,
            status: 'ACTIVE',
            reportedBy: actor.id,
            description: dto.description ?? null
          }
        })

        const counter = await tx.serial_counters.upsert({
          where: { year: nextYear() },
          update: { lastValue: { increment: 1 } },
          create: { year: nextYear(), lastValue: 1 }
        })
        const reportNumber = `NG-REP-${nextYear()}-${String(counter.lastValue).padStart(6, '0')}`
        await tx.incident_reports.create({
          data: {
            incidentId: incident.id,
            reportNumber,
            details: dto.details ?? null,
            status: 'SUBMITTED',
            reportedBy: actor.id
          }
        })

        if (pieceStatus) {
          await tx.jewelry_pieces.update({
            where: { id: piece.id },
            data: { status: pieceStatus }
          })
        }

        return incident
      })

      this.audit.record(actor.id, {
        action: AuditAction.INCIDENT_REPORTED,
        entityType: 'incident',
        entityId: incident.id,
        metadata: { pieceId: piece.id, type: dto.type }
      })

      await this.events.emit('incident.reported', {
        incidentId: incident.id,
        pieceId: piece.id,
        serialNumber: piece.serialNumber,
        type: dto.type,
        status: 'ACTIVE',
        reportedBy: actor.id
      })

      return this.detail(incident.id)
    } catch (error) {
      // Dos reportes concurrentes de la misma pieza: el partial unique index
      // uq_incidents_one_open_per_piece falla con P2002 en el segundo.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('La pieza ya tiene un incidente abierto')
      }
      throw error
    }
  }

  /** Añade un reporte de seguimiento a un incidente propio (o staff). */
  async addReport(id: string, dto: AddIncidentReportDto, actor: { id: string; permissions: string[] }) {
    const incident = await this.load(id)
    if (incident.status !== 'ACTIVE' && incident.status !== 'UNDER_REVIEW') {
      throw new BadRequestException(`No se pueden añadir reportes a un incidente ${incident.status}`)
    }
    if (incident.reportedBy !== actor.id && !this.isStaff(actor)) {
      throw new ForbiddenException('Solo el reporter o staff pueden añadir reportes')
    }

    const counter = await this.prisma.serial_counters.upsert({
      where: { year: nextYear() },
      update: { lastValue: { increment: 1 } },
      create: { year: nextYear(), lastValue: 1 }
    })
    const reportNumber = `NG-REP-${nextYear()}-${String(counter.lastValue).padStart(6, '0')}`
    await this.prisma.incident_reports.create({
      data: {
        incidentId: incident.id,
        reportNumber,
        details: dto.details ?? null,
        status: 'SUBMITTED',
        reportedBy: actor.id
      }
    })

    this.audit.record(actor.id, {
      action: AuditAction.INCIDENT_REPORT_ADDED,
      entityType: 'incident',
      entityId: incident.id
    })

    return this.detail(incident.id)
  }

  /** Revisión staff: ACTIVE → UNDER_REVIEW y verifica el último reporte. */
  async review(id: string, actor: { id: string; permissions: string[] }) {
    const incident = await this.load(id)
    if (incident.status !== 'ACTIVE') {
      throw new BadRequestException(`Solo se puede revisar un incidente ACTIVE (actual: ${incident.status})`)
    }

    await this.prisma.$transaction([
      this.prisma.incidents.update({
        where: { id: incident.id },
        data: { status: 'UNDER_REVIEW' }
      }),
      this.prisma.incident_reports.updateMany({
        where: { incidentId: incident.id, status: 'SUBMITTED' },
        data: { status: 'VERIFIED' }
      })
    ])

    this.audit.record(actor.id, {
      action: AuditAction.INCIDENT_REVIEWED,
      entityType: 'incident',
      entityId: incident.id,
      metadata: { pieceId: incident.pieceId }
    })

    return this.detail(incident.id)
  }

  /** Recuperación de la pieza: incidente RECOVERED y pieza de vuelta al stock. */
  async recover(id: string, actor: { id: string; permissions: string[] }) {
    const incident = await this.load(id)
    if (incident.status !== 'ACTIVE' && incident.status !== 'UNDER_REVIEW') {
      throw new BadRequestException(`No se puede recuperar un incidente ${incident.status}`)
    }

    const now = new Date()
    await this.prisma.$transaction([
      this.prisma.incidents.update({
        where: { id: incident.id },
        data: { status: 'RECOVERED', resolvedAt: now, resolvedBy: actor.id }
      }),
      this.prisma.jewelry_pieces.updateMany({
        where: { id: incident.pieceId, status: { in: ['REPORTED_STOLEN', 'LOST'] } },
        data: { status: 'AVAILABLE' }
      })
    ])

    this.audit.record(actor.id, {
      action: AuditAction.INCIDENT_RECOVERED,
      entityType: 'incident',
      entityId: incident.id,
      metadata: { pieceId: incident.pieceId }
    })

    await this.events.emit('incident.recovered', {
      incidentId: incident.id,
      pieceId: incident.pieceId,
      serialNumber: incident.piece.serialNumber,
      reportedBy: incident.reportedBy,
      resolvedBy: actor.id
    })

    return this.detail(incident.id)
  }

  /** Resolución administrativa del incidente. */
  async resolve(id: string, actor: { id: string; permissions: string[] }) {
    const incident = await this.load(id)
    if (incident.status !== 'ACTIVE' && incident.status !== 'UNDER_REVIEW') {
      throw new BadRequestException(`No se puede resolver un incidente ${incident.status}`)
    }

    const now = new Date()
    await this.prisma.$transaction([
      this.prisma.incidents.update({
        where: { id: incident.id },
        data: { status: 'RESOLVED', resolvedAt: now, resolvedBy: actor.id }
      }),
      this.prisma.jewelry_pieces.updateMany({
        where: { id: incident.pieceId, status: { in: ['REPORTED_STOLEN', 'LOST'] } },
        data: { status: 'AVAILABLE' }
      })
    ])

    this.audit.record(actor.id, {
      action: AuditAction.INCIDENT_RESOLVED,
      entityType: 'incident',
      entityId: incident.id,
      metadata: { pieceId: incident.pieceId }
    })

    await this.events.emit('incident.resolved', {
      incidentId: incident.id,
      pieceId: incident.pieceId,
      serialNumber: incident.piece.serialNumber,
      reportedBy: incident.reportedBy,
      resolvedBy: actor.id
    })

    return this.detail(incident.id)
  }

  async findById(id: string, viewer: { id: string; permissions: string[] }) {
    const incident = await this.load(id)
    const canReadAll = viewer.permissions.includes('incidents:read')
    if (!canReadAll && incident.reportedBy !== viewer.id) {
      throw new ForbiddenException('No tienes permiso para ver este incidente')
    }
    return serializeIncident(incident)
  }

  async list(query: IncidentListQuery, viewer: { id: string; permissions: string[] }) {
    const limit = Math.min(Math.max(query.limit, 1), MAX_LIMIT)
    const offset = Math.max(query.offset, 0)

    const where: Prisma.incidentsWhereInput = {}
    if (query.type) where.type = query.type
    if (query.status) where.status = query.status
    if (!viewer.permissions.includes('incidents:read')) {
      where.reportedBy = viewer.id
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.incidents.findMany({
        where,
        orderBy: { reportedAt: 'desc' },
        skip: offset,
        take: limit,
        include: {
          piece: {
            select: { id: true, internalId: true, serialNumber: true, publicId: true, status: true }
          },
          reporter: { select: { id: true, email: true, firstName: true, lastName: true } },
          reports: {
            orderBy: { createdAt: 'desc' as const },
            select: {
              id: true,
              reportNumber: true,
              details: true,
              status: true,
              createdAt: true
            }
          }
        }
      }),
      this.prisma.incidents.count({ where })
    ])

    return { items, total: Number(total), limit, offset }
  }

  parseListQuery(query: Record<string, unknown>): IncidentListQuery {
    let type: IncidentType | undefined
    if (typeof query['type'] === 'string' && (Object.values(IncidentType) as string[]).includes(query['type'])) {
      type = query['type'] as IncidentType
    }
    let status: IncidentStatus | undefined
    if (
      typeof query['status'] === 'string' &&
      (Object.values(IncidentStatus) as string[]).includes(query['status'])
    ) {
      status = query['status'] as IncidentStatus
    }
    const limit = this.parseIntParam(query['limit'], DEFAULT_LIMIT, 1)
    const offset = this.parseIntParam(query['offset'], 0, 0)
    return { type, status, limit, offset }
  }

  /** Expone la pieza (status) y owner actual para el guard de transfers. */
  async hasOpenIncident(pieceId: string): Promise<boolean> {
    const incident = await this.prisma.incidents.findFirst({
      where: { pieceId, status: { in: OPEN_INCIDENT_STATUSES } },
      select: { id: true }
    })
    return incident !== null
  }

  private isStaff(actor: { permissions: string[] }): boolean {
    return actor.permissions.includes('incidents:read')
  }

  private async load(id: string): Promise<IncidentDetail> {
    const incident = await this.prisma.incidents.findUnique({
      where: { id },
      include: INCIDENT_DETAIL_INCLUDE
    })
    if (!incident) throw new NotFoundException('Incidente no encontrado')
    return incident
  }

  private async detail(id: string) {
    const incident = await this.load(id)
    return serializeIncident(incident)
  }

  private parseIntParam(raw: unknown, fallback: number, min: number): number {
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return fallback
    const value = Number(raw)
    if (Number.isNaN(value) || value < min) throw new BadRequestException('Parámetros de paginación inválidos')
    return value
  }
}

function serializeIncident(incident: IncidentDetail) {
  return {
    id: incident.id,
    piece: incident.piece,
    type: incident.type,
    status: incident.status,
    description: incident.description,
    reportedBy: incident.reporter,
    reportedAt: incident.reportedAt,
    resolvedAt: incident.resolvedAt,
    resolvedBy: incident.resolvedBy,
    createdAt: incident.createdAt,
    reports: incident.reports.map((report) => ({
      id: report.id,
      reportNumber: report.reportNumber,
      details: report.details,
      status: report.status,
      reportedBy: report.reporter,
      createdAt: report.createdAt
    }))
  }
}