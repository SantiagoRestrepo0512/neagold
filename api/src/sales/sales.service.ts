import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { AuditAction, AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import { EventsService } from '../events/events.service'
import { formatInvoiceNumber, newClaimCode, nextYear, sha256 } from '../common/utils/tokens'
import { CreateSaleDto } from './dto/create-sale.dto'

const CLAIM_TTL_DAYS = 30

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventsService
  ) {}

  /**
   * Venta en tienda: valida la pieza, genera factura, marca la pieza SOLD
   * y emite el código de reclamación post-venta de un solo uso. El ownership
   * del comprador NO se crea aquí: nace cuando el comprador canjea su código
   * (acquisition_type = CLAIM), respetando la invariante de un único
   * propietario activo por pieza (trigger SQL piece_already_has_active_owner).
   */
  async create(dto: CreateSaleDto, actorId: string) {
    const saleDate = dto.saleDate ? new Date(dto.saleDate) : new Date()
    const pieceSerial = await this.prisma.jewelry_pieces
      .findUnique({ where: { id: dto.pieceId }, select: { serialNumber: true } })
      .then((piece) => piece?.serialNumber ?? '')

    const result = await this.prisma.$transaction(async (tx) => {
      const piece = await tx.jewelry_pieces.findUnique({
        where: { id: dto.pieceId },
        include: { digitalIdentity: true }
      })
      if (!piece) throw new NotFoundException('Pieza no encontrada')
      if (piece.status !== 'IN_STOCK' && piece.status !== 'AVAILABLE') {
        throw new BadRequestException(
          `La pieza está en estado ${piece.status}; solo se pueden vender piezas en stock`
        )
      }
      if (!piece.digitalIdentity || piece.digitalIdentity.status !== 'ACTIVE') {
        throw new ServiceUnavailableException('La pieza no tiene identidad digital activa para venderse')
      }
      // Una transferencia PENDING reserva la pieza: venderla permitiría al
      // destinatario quedarse con la propiedad del comprador real al aceptar.
      const pendingTransfer = await tx.ownership_transfers.findFirst({
        where: { pieceId: piece.id, status: 'PENDING' },
        select: { id: true }
      })
      if (pendingTransfer) {
        throw new BadRequestException(
          'La pieza tiene una transferencia pendiente; cancélala antes de venderla'
        )
      }

      const buyer = await tx.users.findUnique({ where: { id: dto.buyerId } })
      if (!buyer || buyer.status !== 'ACTIVE') {
        throw new BadRequestException('El comprador no existe o no está activo')
      }

      const year = nextYear()
      const counter = await tx.serial_counters.upsert({
        where: { year },
        update: { lastValue: { increment: 1 } },
        create: { year, lastValue: 1 }
      })
      const invoiceNumber = formatInvoiceNumber(year, counter.lastValue)
      const claimCode = newClaimCode(year)

      const claim = await tx.piece_claim_codes.create({
        data: {
          pieceId: piece.id,
          codeHash: sha256(claimCode),
          status: 'PENDING',
          expiresAt: new Date(saleDate.getTime() + CLAIM_TTL_DAYS * 24 * 60 * 60 * 1000),
          createdBy: actorId
        }
      })

      const sale = await tx.sales.create({
        data: {
          pieceId: piece.id,
          buyerId: dto.buyerId,
          soldBy: actorId,
          amount: dto.amount,
          saleDate,
          invoiceNumber,
          claimCode: { connect: { id: claim.id } }
        }
      })

      await tx.jewelry_pieces.update({
        where: { id: piece.id },
        data: { status: 'SOLD' }
      })

      this.audit.record(actorId, {
        action: AuditAction.SALE_CREATED,
        entityType: 'sale',
        entityId: sale.id,
        metadata: { invoiceNumber, pieceId: piece.id }
      })

      const result = {
        sale: {
          id: sale.id,
          invoiceNumber,
          amount: sale.amount,
          saleDate,
          buyerId: sale.buyerId
        },
        claimCode,
        claimExpiresAt: claim.expiresAt
      }

      return result
    })

    await this.events.emit('sale.created', {
      saleId: result.sale.id,
      invoiceNumber: result.sale.invoiceNumber,
      pieceId: dto.pieceId,
      serialNumber: pieceSerial,
      buyerId: result.sale.buyerId,
      amount: result.sale.amount.toString(),
      saleDate: result.sale.saleDate.toISOString(),
      claimExpiresAt: result.claimExpiresAt.toISOString()
    })

    return result
  }

  async findById(id: string) {
    const sale = await this.prisma.sales.findUnique({
      where: { id },
      include: {
        piece: {
          select: {
            id: true,
            internalId: true,
            serialNumber: true,
            publicId: true,
            status: true
          }
        },
        buyer: { select: { id: true, email: true, firstName: true, lastName: true } },
        claimCode: { select: { status: true, expiresAt: true, usedAt: true } }
      }
    })
    if (!sale) throw new NotFoundException('Venta no encontrada')
    return sale
  }

  async list(query: Record<string, unknown>, viewer: { id: string; permissions: string[] }) {
    const limit = this.parseIntParam(query['limit'], 25, 1)
    const offset = this.parseIntParam(query['offset'], 0, 0)

    const where: Prisma.salesWhereInput = {}
    if (!viewer.permissions.includes('sales:read')) {
      // staff sin sales:read (no existe hoy) o cliente con acceso a sus ventas
      where.buyerId = viewer.id
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.sales.findMany({
        where,
        orderBy: { saleDate: 'desc' },
        skip: offset,
        take: limit,
        select: {
          id: true,
          invoiceNumber: true,
          amount: true,
          saleDate: true,
          piece: { select: { id: true, serialNumber: true, status: true } },
          buyer: { select: { id: true, email: true, firstName: true, lastName: true } },
          claimCode: { select: { status: true, expiresAt: true } }
        }
      }),
      this.prisma.sales.count({ where })
    ])

    return { items, total: Number(total), limit, offset }
  }

  private parseIntParam(raw: unknown, fallback: number, min: number): number {
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return fallback
    const value = Number(raw)
    if (Number.isNaN(value) || value < min) throw new BadRequestException('Parámetros de paginación inválidos')
    return value
  }
}