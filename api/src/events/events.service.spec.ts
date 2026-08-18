import { describe, expect, it, vi } from 'vitest'
import { EventsService } from './events.service'

describe('EventsService', () => {
  it('registra y propaga eventos a los suscriptores', async () => {
    const bus = new EventsService()
    const handler = vi.fn()
    bus.on('transfer.requested', handler)

    await bus.emit('transfer.requested', { transferId: 'abc' })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toMatchObject({
      event: 'transfer.requested',
      payload: { transferId: 'abc' }
    })
    expect(typeof handler.mock.calls[0][0].occurredAt).toBe('string')
  })

  it('no propaga eventos sin suscriptores', async () => {
    const bus = new EventsService()
    const handler = vi.fn()
    bus.on('sale.created', handler)

    await bus.emit('transfer.accepted', { transferId: 'x' })

    expect(handler).not.toHaveBeenCalled()
  })

  it('soporta múltiples suscriptores del mismo evento', async () => {
    const bus = new EventsService()
    const a = vi.fn()
    const b = vi.fn()
    bus.on('claim.redeemed', a)
    bus.on('claim.redeemed', b)

    await bus.emit('claim.redeemed', {})

    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('un handler fallido no rompe la emisión ni a los demás', async () => {
    const bus = new EventsService()
    const broken = vi.fn(() => {
      throw new Error('boom')
    })
    const fine = vi.fn()
    bus.on('incident.reported', broken)
    bus.on('incident.reported', fine)

    await expect(bus.emit('incident.reported', { pieceId: '1' })).resolves.toBeUndefined()
    expect(fine).toHaveBeenCalledTimes(1)
  })

  it('espera a los handlers asíncronos antes de resolver', async () => {
    const bus = new EventsService()
    let done = false
    bus.on('transfer.accepted', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      done = true
    })

    await bus.emit('transfer.accepted', {})
    expect(done).toBe(true)
  })

  it('reporta si un evento tiene suscriptores', () => {
    const bus = new EventsService()
    expect(bus.hasListeners('sale.created')).toBe(false)
    bus.on('sale.created', vi.fn())
    expect(bus.hasListeners('sale.created')).toBe(true)
  })
})