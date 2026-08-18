import { Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { EnvConfig } from '../config/env.validation'
import { PrismaService } from '../prisma/prisma.service'

/**
 * Verificación pública de identidad digital.
 *
 * Sirve la URL estampada en el QR de cada pieza
 * (https://neagold.com/verify/{publicToken}) y solo confirma la autenticidad
 * de piezas con identidad ACTIVA. Respuestas sin credenciales: no expone
 * emails, ids internos, hashes ni creadores. Una identidad revocada/inexistente
 * devuelve 404 a propósito (indistinguible para no filtrar existencia).
 */
@Injectable()
export class VerificationService {
  private readonly verifyOwnerName: boolean

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<EnvConfig, true>
  ) {
    // El nombre del propietario es un dato personal: solo se publica si el
    // operador lo habilita explícitamente (VERIFY_OWNER_NAME=true).
    this.verifyOwnerName = config.get('verifyOwnerName', { infer: true })
  }

  async verify(publicToken: string) {
    const identity = await this.prisma.digital_identities.findUnique({
      where: { publicToken },
      include: {
        piece: {
          include: {
            product: {
              select: { id: true, sku: true, name: true, category: true, basePurity: true }
            }
          }
        }
      }
    })
    if (!identity || identity.status !== 'ACTIVE') {
      throw new NotFoundException('Identidad digital no encontrada')
    }

    const activeOwnership = this.verifyOwnerName
      ? await this.prisma.ownership_records.findFirst({
          where: { pieceId: identity.pieceId, endDate: null },
          include: { owner: { select: { firstName: true, lastName: true } } }
        })
      : null

    return {
      verified: true,
      piece: {
        publicId: identity.piece.publicId,
        serialNumber: identity.piece.serialNumber,
        material: identity.piece.material,
        purity: identity.piece.purity,
        weightGrams: identity.piece.weightGrams,
        manufacturingDate: identity.piece.manufacturingDate,
        status: identity.piece.status
      },
      product: identity.piece.product,
      identity: {
        registeredAt: identity.createdAt
      },
      ownership: activeOwnership
        ? {
            registered: true,
            ownerName: activeOwnership.owner
              ? `${activeOwnership.owner.firstName} ${activeOwnership.owner.lastName}`.trim()
              : null
          }
        : { registered: false, ownerName: null }
    }
  }
}