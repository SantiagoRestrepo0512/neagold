export const BASE = `${import.meta.env.VITE_API_ORIGIN ?? ''}/api/v1`
export const PUBLIC_BASE = import.meta.env.VITE_API_ORIGIN ?? ''
const CSRF_HEADER = 'x-csrf-token'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

let csrfToken: string | null = null
let refreshPromise: Promise<boolean> | null = null

export function clearCsrf(): void {
  csrfToken = null
}

async function fetchCsrf(): Promise<string> {
  const res = await fetch(`${BASE}/auth/csrf`, { credentials: 'include' })
  if (!res.ok) throw new ApiError(res.status, 'No se pudo iniciar la sesión segura')
  const data = (await res.json()) as { csrfToken: string }
  csrfToken = data.csrfToken
  return csrfToken
}

async function ensureCsrf(): Promise<string> {
  if (csrfToken) return csrfToken
  return fetchCsrf()
}

function tryRefreshOnce(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) return false
        const data = (await res.json()) as { refreshed: boolean }
        return data.refreshed === true
      })
      .catch(() => false)
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string | string[] }
    if (typeof body.message === 'string') return body.message
    if (Array.isArray(body.message) && body.message.length > 0) return body.message[0]
    return res.statusText || 'Error del servidor'
  } catch {
    return res.statusText || 'Error del servidor'
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  // false = no enviar X-CSRF-Token (p.ej. refresh/logout que ya lo omiten)
  csrf?: boolean
}

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, csrf = MUTATING.has(method) } = options

  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (csrf) headers[CSRF_HEADER] = await ensureCsrf()

  let res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined
  })

  if (res.status === 401 && method !== 'GET' && !path.startsWith('/auth/')) {
    const refreshed = await tryRefreshOnce()
    if (refreshed) {
      csrfToken = null
      headers[CSRF_HEADER] = await ensureCsrf()
      res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        credentials: 'include',
        body: body !== undefined ? JSON.stringify(body) : undefined
      })
    }
  }

  if (!res.ok) throw new ApiError(res.status, await errorMessage(res))
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const http = {
  get: <T>(path: string) => api<T>(path),
  post: <T>(path: string, body?: unknown, csrf?: boolean) => api<T>(path, { method: 'POST', body, csrf }),
  patch: <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => api<T>(path, { method: 'DELETE' })
}

export function queryString(params: Record<string, string | number | boolean | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '' && v !== false)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  return parts.length > 0 ? `?${parts.join('&')}` : ''
}