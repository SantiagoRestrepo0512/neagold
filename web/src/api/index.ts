import { ApiError, BASE, http, PUBLIC_BASE, queryString } from './client'
export { WEBHOOK_EVENTS } from './types'
import type {
  CertificateItem,
  CertificateType,
  ClaimItem,
  IncidentItem,
  IncidentType,
  NotificationsResponse,
  Page,
  PieceDetail,
  PieceListItem,
  Product,
  Profile,
  SaleItem,
  ServiceRecord,
  ServiceType,
  Session,
  TransferItem,
  VerifyResponse,
  Webhook,
  WebhookDelivery,
  WebhookEvent
} from './types'

function publicGet<T>(path: string): Promise<T> {
  return fetch(`${PUBLIC_BASE}${path}`, { credentials: 'include' }).then((res) => {
    if (!res.ok) {
      return res
        .json()
        .catch(() => ({}))
        .then((body: { message?: string | string[] }) => {
          const message =
            typeof body.message === 'string'
              ? body.message
              : Array.isArray(body.message) && body.message.length > 0
                ? body.message[0]
                : 'Error del servidor'
          throw Object.assign(new Error(message), { status: res.status })
        })
    }
    return res.json() as Promise<T>
  })
}

// ---------- Auth ----------

export const authApi = {
  login: (email: string, password: string) =>
    http.post<{ user: { id: string; email: string } }>('/auth/login', { email, password }),
  register: (data: {
    email: string
    password: string
    firstName: string
    lastName: string
  }) => http.post<{ id: string; email: string; devVerifyUrl?: string }>('/auth/register', data),
  logout: () => http.post<undefined>('/auth/logout', undefined, false),
  verifyEmail: (token: string) => http.get<{ verified: boolean }>(`/auth/verify-email/${token}`),
  resendVerification: (email: string) =>
    http.post<{ sent: true; devVerifyUrl?: string }>('/auth/resend-verification', { email }),
  forgotPassword: (email: string) =>
    http.post<{ sent: true; devResetUrl?: string }>('/auth/forgot-password', { email }),
  resetPassword: (token: string, newPassword: string) =>
    http.post<{ reset: true }>('/auth/reset-password', { token, newPassword })
}

// ---------- Users (perfil) ----------

export const usersApi = {
  me: () => http.get<Profile>('/users/me'),
  listActive: (search?: string) =>
    http.get<
      { id: string; email: string; firstName: string; lastName: string; status: string }[]
    >(`/users${queryString({ search: search || undefined })}`),
  updateMe: (data: { firstName?: string; lastName?: string }) =>
    http.patch<Profile>('/users/me', data),
  sessions: () => http.get<Session[]>('/users/me/sessions'),
  revokeSession: (id: string) =>
    http.del<{ revoked: true; isCurrent: boolean }>(`/users/me/sessions/${id}`),
  changePassword: (currentPassword: string, newPassword: string) =>
    http.post<{ changed: true }>('/users/me/change-password', { currentPassword, newPassword })
}

// ---------- Products ----------

export const productsApi = {
  list: (params: { search?: string; limit?: number; offset?: number } = {}) =>
    http.get<Page<Product & { _count: { pieces: number } }>>(
      `/products${queryString({ search: params.search, limit: params.limit, offset: params.offset })}`
    ),
  create: (data: {
    sku: string
    name: string
    description?: string
    category: string
    basePurity: string
    baseWeightGrams?: string
    imageUrl?: string
    isActive?: boolean
  }) => http.post<Product>('/products', data),
  update: (
    id: string,
    data: Partial<{
      sku: string
      name: string
      description: string
      category: string
      basePurity: string
      baseWeightGrams: string
      imageUrl: string
      isActive: boolean
    }>
  ) => http.patch<Product>(`/products/${id}`, data)
}

// ---------- Pieces ----------

export const piecesApi = {
  list: (params: { status?: string; search?: string; limit?: number; offset?: number } = {}) =>
    http.get<Page<PieceListItem>>(
      `/pieces${queryString({
        status: params.status,
        search: params.search,
        limit: params.limit,
        offset: params.offset
      })}`
    ),
  detail: (id: string) => http.get<PieceDetail>(`/pieces/${id}`),
  create: (data: {
    productId: string
    internalId?: string
    material: string
    weightGrams: string
    purity: string
    manufacturingDate: string
  }) =>
    http.post<PieceDetail & { identityHash: string; verifyUrl: string; qrToken: string }>(
      '/pieces',
      data
    ),
  updateStatus: (id: string, status: string) =>
    http.post<PieceDetail & Record<string, unknown>>(`/pieces/${id}/status`, { status }),
  retire: (id: string) => http.post<Record<string, unknown>>(`/pieces/${id}/retire`),
  regenerateQr: (id: string) =>
    http.post<{ qrToken: string; verifyUrl: string; previousRevoked: true }>(
      `/pieces/${id}/qr/regenerate`
    )
}

// ---------- Sales ----------

export const salesApi = {
  list: (params: { limit?: number; offset?: number } = {}) =>
    http.get<Page<SaleItem>>(`/sales${queryString(params)}`),
  create: (data: { pieceId: string; buyerId: string; amount: string; saleDate?: string }) =>
    http.post<{
      sale: { id: string; invoiceNumber: string; amount: string; saleDate: string; buyerId: string }
      claimCode: string
      claimExpiresAt: string
    }>('/sales', data)
}

// ---------- Claims ----------

export const claimsApi = {
  list: (params: { limit?: number; offset?: number } = {}) =>
    http.get<Page<ClaimItem>>(`/claims${queryString(params)}`),
  redeem: (code: string) =>
    http.post<{
      redeemed: true
      piece: { id: string; serialNumber: string; publicId: string; internalId: string }
      verifyUrl: string
    }>('/claims/redeem', { code })
}

// ---------- Transfers ----------

export const transfersApi = {
  incoming: (params: { limit?: number; offset?: number } = {}) =>
    http.get<Page<TransferItem>>(`/transfers/incoming${queryString(params)}`),
  outgoing: (params: { limit?: number; offset?: number } = {}) =>
    http.get<Page<TransferItem>>(`/transfers/outgoing${queryString(params)}`),
  all: (params: { limit?: number; offset?: number } = {}) =>
    http.get<Page<TransferItem>>(`/transfers${queryString(params)}`),
  request: (pieceId: string, toUserId: string) =>
    http.post<TransferItem>('/transfers', { pieceId, toUserId }),
  accept: (id: string) => http.post<TransferItem>(`/transfers/${id}/accept`),
  reject: (id: string) => http.post<TransferItem>(`/transfers/${id}/reject`),
  cancel: (id: string) => http.post<TransferItem>(`/transfers/${id}/cancel`)
}

// ---------- Incidents ----------

export const incidentsApi = {
  list: (params: { type?: IncidentType; status?: string; limit?: number; offset?: number } = {}) =>
    http.get<Page<IncidentItem>>(
      `/incidents${queryString({
        type: params.type,
        status: params.status,
        limit: params.limit,
        offset: params.offset
      })}`
    ),
  detail: (id: string) => http.get<IncidentItem>(`/incidents/${id}`),
  create: (data: { pieceId: string; type: IncidentType; description?: string; details?: string }) =>
    http.post<IncidentItem>('/incidents', data),
  addReport: (id: string, details?: string) =>
    http.post<IncidentItem>(`/incidents/${id}/reports`, { details }),
  review: (id: string) => http.post<IncidentItem>(`/incidents/${id}/review`),
  recover: (id: string) => http.post<IncidentItem>(`/incidents/${id}/recover`),
  resolve: (id: string) => http.post<IncidentItem>(`/incidents/${id}/resolve`)
}

// ---------- Notifications ----------

export const notificationsApi = {
  list: (params: { unread?: boolean; limit?: number; offset?: number } = {}) =>
    http.get<NotificationsResponse>(
      `/notifications${queryString({
        unread: params.unread === true ? 'true' : undefined,
        limit: params.limit,
        offset: params.offset
      })}`
    ),
  markRead: (id: string) => http.patch<{ id: string; readAt: string }>(`/notifications/${id}/read`),
  markAllRead: () => http.patch<{ updated: number }>('/notifications/read-all')
}

// ---------- Webhooks ----------

export const webhooksApi = {
  list: (params: { limit?: number; offset?: number } = {}) =>
    http.get<Page<Webhook>>(`/webhooks${queryString(params)}`),
  detail: (id: string) => http.get<{ webhook: Webhook }>(`/webhooks/${id}`),
  deliveries: (id: string, params: { limit?: number; offset?: number } = {}) =>
    http.get<Page<WebhookDelivery>>(`/webhooks/${id}/deliveries${queryString(params)}`),
  create: (data: { url: string; events: WebhookEvent[] }) =>
    http.post<{ webhook: Webhook; secret: string }>('/webhooks', data),
  update: (id: string, data: { url?: string; events?: WebhookEvent[]; isActive?: boolean }) =>
    http.patch<{ webhook: Webhook }>(`/webhooks/${id}`, data),
  rotateSecret: (id: string) => http.post<{ secret: string }>(`/webhooks/${id}/secret`),
  remove: (id: string) => http.del<{ deleted: true }>(`/webhooks/${id}`)
}

// ---------- Verify (portal público) ----------

export const verifyApi = {
  check: (publicToken: string) => publicGet<VerifyResponse>(`/verify/${publicToken}`)
}

// ---------- Certificados ----------

export const certificatesApi = {
  list: (params: { limit?: number; offset?: number } = {}) =>
    http.get<Page<CertificateItem>>(`/certificates${queryString(params)}`),
  create: (data: { pieceId: string; type: CertificateType; fileUrl?: string }) =>
    http.post<{ certificate: CertificateItem; document: string; documentHash: string }>(
      '/certificates',
      data
    ),
  revoke: (id: string) => http.post<CertificateItem>(`/certificates/${id}/revoke`),
  download: async (id: string): Promise<{ document: string; documentHash: string }> => {
    const res = await fetch(`${BASE}/certificates/${id}/download`, { credentials: 'include' })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string }
      throw new ApiError(res.status, body.message ?? 'No se pudo descargar el certificado')
    }
    return {
      document: await res.text(),
      documentHash: res.headers.get('X-Document-SHA256') ?? ''
    }
  }
}

// ---------- Servicios ----------

export const servicesApi = {
  list: (params: { limit?: number; offset?: number } = {}) =>
    http.get<Page<ServiceRecord>>(`/services${queryString(params)}`),
  create: (data: {
    pieceId: string
    type: ServiceType
    notes?: string
    scheduledAt?: string
  }) => http.post<{ service: ServiceRecord }>('/services', data),
  start: (id: string) => http.post<{ service: ServiceRecord }>(`/services/${id}/start`),
  complete: (id: string, notes?: string) =>
    http.post<{ service: ServiceRecord }>(`/services/${id}/complete`, notes ? { notes } : {}),
  cancel: (id: string) => http.post<{ service: ServiceRecord }>(`/services/${id}/cancel`)
}