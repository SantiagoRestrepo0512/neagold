export type UserStatus = 'ACTIVE' | 'PENDING_VERIFICATION' | 'DISABLED' | 'LOCKED'

export interface Profile {
  id: string
  email: string
  firstName: string
  lastName: string
  status: UserStatus
  emailVerifiedAt: string | null
  createdAt: string
  roles: string[]
  permissions: string[]
}

export interface Session {
  id: string
  ipAddress: string | null
  userAgent: string | null
  expiresAt: string
  lastUsedAt: string | null
  createdAt: string
  isCurrent: boolean
}

export interface Page<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export interface Product {
  id: string
  sku: string
  name: string
  description: string | null
  category: string
  basePurity: string
  baseWeightGrams: string | null
  imageUrl: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface ProductListItem extends Product {
  _count: { pieces: number }
}

export type PieceStatus =
  | 'IN_STOCK'
  | 'AVAILABLE'
  | 'SOLD'
  | 'IN_SERVICE'
  | 'REPORTED_STOLEN'
  | 'LOST'
  | 'RETIRED'

export interface PieceListItem {
  id: string
  internalId: string
  publicId: string
  serialNumber: string
  weightGrams: string
  purity: string
  material: string
  status: PieceStatus
  manufacturingDate: string
  createdAt: string
  product: { id: string; sku: string; name: string }
}

export interface PieceDetail extends PieceListItem {
  product: Product
  digitalIdentity: { publicToken: string; status: 'ACTIVE' | 'SUSPENDED' } | null
  currentOwner: {
    id: string
    email: string
    firstName: string
    lastName: string
  } | null
  activeQr: { token: string } | null
}

export interface SaleItem {
  id: string
  invoiceNumber: string
  amount: string
  saleDate: string
  piece: { id: string; serialNumber: string; status: PieceStatus }
  buyer: { id: string; email: string; firstName: string; lastName: string }
  claimCode: { status: 'PENDING' | 'USED' | 'EXPIRED' | 'REVOKED'; expiresAt: string }
}

export interface ClaimItem {
  id: string
  pieceId: string
  status: 'PENDING' | 'USED' | 'EXPIRED' | 'REVOKED'
  expiresAt: string
  usedAt: string | null
  createdAt: string
  sale: { invoiceNumber: string; buyerId: string }
}

export type TransferStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED'

export interface TransferItem {
  id: string
  piece: { id: string; internalId: string; serialNumber: string; status: PieceStatus }
  fromUser: { id: string; email: string; firstName: string; lastName: string }
  toUser: { id: string; email: string; firstName: string; lastName: string }
  status: TransferStatus
  expiresAt: string
  createdAt: string
  acceptedAt: string | null
  rejectedAt: string | null
  cancelledAt: string | null
}

export type IncidentType = 'STOLEN' | 'LOST' | 'FRAUD' | 'OTHER'
export type IncidentStatus = 'ACTIVE' | 'UNDER_REVIEW' | 'RECOVERED' | 'RESOLVED' | 'REJECTED'

export interface IncidentItem {
  id: string
  piece: { id: string; internalId: string; serialNumber: string; publicId: string; status: PieceStatus }
  type: IncidentType
  status: IncidentStatus
  description: string | null
  reporter: { id: string; email: string; firstName: string; lastName: string }
  reportedAt: string
  resolvedAt: string | null
  resolvedBy: string | null
  createdAt: string
  reports: {
    id: string
    reportNumber: string
    details: string | null
    status: 'SUBMITTED' | 'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED'
    createdAt: string
    reportedBy?: { id: string; firstName: string; lastName: string }
  }[]
}

export type NotificationType =
  | 'TRANSFER_REQUEST'
  | 'TRANSFER_ACCEPTED'
  | 'TRANSFER_REJECTED'
  | 'PIECE_REPORTED'
  | 'PIECE_RECOVERED'
  | 'CERTIFICATE_ISSUED'
  | 'SERVICE_COMPLETED'
  | 'CLAIM_AVAILABLE'
  | 'SYSTEM'

export interface NotificationItem {
  id: string
  type: NotificationType
  payload: Record<string, unknown>
  readAt: string | null
  createdAt: string
}

export interface NotificationsResponse {
  items: NotificationItem[]
  total: number
  unreadCount: number
  limit: number
  offset: number
}

export const WEBHOOK_EVENTS = [
  'transfer.requested',
  'transfer.accepted',
  'transfer.rejected',
  'transfer.cancelled',
  'sale.created',
  'claim.redeemed',
  'incident.reported',
  'incident.recovered',
  'incident.resolved',
  'certificate.issued',
  'service.completed'
] as const

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]

export interface Webhook {
  id: string
  url: string
  events: string[]
  isActive: boolean
  failureCount: number
  lastDeliveryAt: string | null
  createdAt: string
  updatedAt: string
}

export type WebhookDeliveryStatus = 'PENDING' | 'DELIVERING' | 'SUCCESS' | 'FAILED' | 'CANCELLED'

export interface WebhookDelivery {
  id: string
  eventType: WebhookEvent
  payload: Record<string, unknown>
  status: WebhookDeliveryStatus
  statusCode: number | null
  error: string | null
  attempts: number
  deliveredAt: string | null
  nextAttemptAt: string | null
  createdAt: string
}

export interface VerifyResponse {
  verified: true
  piece: {
    id: string
    publicId: string
    serialNumber: string
    material: string
    purity: string
    weightGrams: string
    manufacturingDate: string
    status: PieceStatus
  }
  product: { id: string; sku: string; name: string; category: string; basePurity: string }
  identity: { registeredAt: string }
  ownership: { registered: boolean; ownerName: string | null }
}

export type CertificateType = 'AUTHENTICITY' | 'APPRAISAL' | 'MAINTENANCE'
export type CertificateStatus = 'ACTIVE' | 'REVOKED'

export interface CertificateItem {
  id: string
  certificateNumber: string
  type: CertificateType
  issuedAt: string
  issuedBy: { id: string; email: string; firstName: string; lastName: string }
  documentHash: string
  fileUrl: string | null
  status: CertificateStatus
  revokedAt: string | null
  createdAt: string
  piece: {
    id: string
    internalId: string
    publicId: string
    serialNumber: string
    material: string
    purity: string
    weightGrams: string
    manufacturingDate: string
    status: PieceStatus
  }
}

export type ServiceType =
  | 'CLEANING'
  | 'REPAIR'
  | 'RESIZE'
  | 'COMPONENT_REPLACEMENT'
  | 'INSPECTION'
  | 'OTHER'

export type ServiceStatus = 'REQUESTED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'

export interface ServiceRecord {
  id: string
  pieceId: string
  type: ServiceType
  status: ServiceStatus
  requestedBy: { id: string; email: string; firstName: string; lastName: string } | null
  performedBy: { id: string; email: string; firstName: string; lastName: string } | null
  notes: string | null
  scheduledAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
  piece: { id: string; publicId: string; serialNumber: string; status: PieceStatus; material: string; purity: string }
}