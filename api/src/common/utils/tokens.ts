import { createHash, randomBytes } from 'node:crypto'

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

/** Token opaco de 64 caracteres hexadecimales (256 bits). */
export function newToken(): string {
  return randomBytes(32).toString('hex')
}

export function nextYear(): number {
  return new Date().getUTCFullYear()
}

/** Serial de pieza: NG-{año}-{000001}. */
export function formatSerial(year: number, sequence: number): string {
  return `NG-${year}-${String(sequence).padStart(6, '0')}`
}

/** Número de factura: NG-INV-{año}-{000001}. */
export function formatInvoiceNumber(year: number, sequence: number): string {
  return `NG-INV-${year}-${String(sequence).padStart(6, '0')}`
}

/** Código de reclamación post-venta: NG-CLAIM-{año}-{32 hex} (128 bits de
 *  entropía). Es la prueba de compra que transfiere propiedad: no puede ser
 *  adivinable por fuerza bruta. */
export function newClaimCode(year: number): string {
  return `NG-CLAIM-${year}-${randomBytes(16).toString('hex').toUpperCase()}`
}