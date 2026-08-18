import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { AuditAction, AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import { CreateProductDto } from './dto/create-product.dto'
import { UpdateProductDto } from './dto/update-product.dto'

export interface ListQuery {
  search?: string
  limit: number
  offset: number
}

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async create(dto: CreateProductDto, actorId: string) {
    const product = await this.prisma.products.create({
      data: {
        sku: dto.sku,
        name: dto.name,
        description: dto.description ?? null,
        category: dto.category,
        basePurity: dto.basePurity,
        baseWeightGrams: dto.baseWeightGrams ?? null,
        imageUrl: dto.imageUrl ?? null,
        isActive: dto.isActive ?? true
      }
    })
    this.audit.record(actorId, {
      action: AuditAction.PRODUCT_CREATED,
      entityType: 'product',
      entityId: product.id,
      metadata: { sku: product.sku }
    })
    return product
  }

  async update(id: string, dto: UpdateProductDto, actorId: string) {
    const product = await this.prisma.products.update({
      where: { id },
      data: {
        ...(dto.sku !== undefined && { sku: dto.sku }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.basePurity !== undefined && { basePurity: dto.basePurity }),
        ...(dto.baseWeightGrams !== undefined && { baseWeightGrams: dto.baseWeightGrams }),
        ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive })
      }
    })
    this.audit.record(actorId, {
      action: AuditAction.PRODUCT_UPDATED,
      entityType: 'product',
      entityId: id
    })
    return product
  }

  async findById(id: string) {
    const product = await this.prisma.products.findUnique({
      where: { id },
      include: { _count: { select: { pieces: true } } }
    })
    if (!product) throw new NotFoundException('Producto no encontrado')
    return product
  }

  async list(query: ListQuery) {
    const limit = Math.min(Math.max(query.limit, 1), MAX_LIMIT)
    const offset = Math.max(query.offset, 0)

    const where: Prisma.productsWhereInput = {}
    if (query.search) {
      where.OR = [
        { sku: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } }
      ]
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.products.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: { _count: { select: { pieces: true } } }
      }),
      this.prisma.products.count({ where })
    ])

    return { items, total: Number(total), limit, offset }
  }

  parseListQuery(query: Record<string, unknown>): ListQuery {
    const limit = this.parseIntParam(query['limit'], DEFAULT_LIMIT, 1)
    const offset = this.parseIntParam(query['offset'], 0, 0)
    const search = typeof query['search'] === 'string' && query['search'].trim() ? query['search'].trim() : undefined
    return { search, limit, offset }
  }

  private parseIntParam(raw: unknown, fallback: number, min: number): number {
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return fallback
    const value = Number(raw)
    if (Number.isNaN(value) || value < min) throw new BadRequestException('Parámetros de paginación inválidos')
    return value
  }
}