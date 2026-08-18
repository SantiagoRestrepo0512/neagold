export function formatDate(value: string | null | Date | undefined): string {
  if (!value) return '—'
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function formatMoney(value: string): string {
  const n = Number(value)
  if (Number.isNaN(n)) return value
  return `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function relativeTime(value: string | null | Date | undefined): string {
  if (!value) return '—'
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return '—'
  const diff = Date.now() - d.getTime()
  const abs = Math.abs(diff)
  if (abs < 60_000) return 'hace un momento'
  if (abs < 3_600_000) return `hace ${Math.floor(abs / 60_000)} min`
  if (abs < 86_400_000) return `hace ${Math.floor(abs / 3_600_000)} h`
  if (abs < 7 * 86_400_000) {
    const days = Math.floor(abs / 86_400_000)
    return diff > 0 ? `hace ${days} d` : `en ${days} d`
  }
  return formatDate(value)
}

export function initials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
}

export function fullName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim()
}