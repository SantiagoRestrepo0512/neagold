<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ApiError } from '@/api/client'
import { notificationsApi } from '@/api'
import { useToastStore } from '@/stores/toast'
import Pagination from '@/components/Pagination.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { relativeTime } from '@/utils/format'
import type { NotificationItem } from '@/api/types'

const toast = useToastStore()

const items = ref<NotificationItem[]>([])
const total = ref(0)
const unreadCount = ref(0)
const limit = 15
const offset = ref(0)
const unreadOnly = ref(false)
const loading = ref(true)

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await notificationsApi.list({
      unread: unreadOnly.value || undefined,
      limit,
      offset: offset.value
    })
    items.value = res.items
    total.value = res.total
    unreadCount.value = res.unreadCount
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudieron cargar las notificaciones')
  } finally {
    loading.value = false
  }
}

async function markRead(n: NotificationItem): Promise<void> {
  if (n.readAt) return
  try {
    await notificationsApi.markRead(n.id)
    n.readAt = new Date().toISOString()
    unreadCount.value = Math.max(0, unreadCount.value - 1)
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudo marcar como leída')
  }
}

async function markAllRead(): Promise<void> {
  if (unreadCount.value === 0) return
  try {
    await notificationsApi.markAllRead()
    toast.success('Todas las notificaciones marcadas como leídas')
    if (unreadOnly.value) {
      items.value = []
      total.value = 0
    } else {
      items.value.forEach((n) => (n.readAt = n.readAt ?? new Date().toISOString()))
    }
    unreadCount.value = 0
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudo completar la acción')
  }
}

function text(n: NotificationItem): string {
  const p = n.payload as Record<string, string | number | undefined>
  switch (n.type) {
    case 'TRANSFER_REQUEST':
      return `${p.fromName ?? 'Un usuario'} quiere transferirte la pieza ${p.serialNumber ?? ''}`
    case 'TRANSFER_ACCEPTED':
      return `${p.fromName ?? 'El usuario'} aceptó tu transferencia de ${p.serialNumber ?? ''}`
    case 'TRANSFER_REJECTED':
      return `${p.toName ?? 'El usuario'} rechazó tu transferencia de ${p.serialNumber ?? ''}`
    case 'CLAIM_AVAILABLE':
      return `Tenés un código de garantía listo para canjear: ${p.serialNumber ?? ''}`
    case 'PIECE_REPORTED':
      return `Se reportó un incidente sobre ${p.serialNumber ?? ''} (${String(p.type ?? '')})`
    case 'PIECE_RECOVERED':
      return `La pieza ${p.serialNumber ?? ''} fue recuperada`
    case 'SYSTEM':
      return String(p.message ?? 'Aviso del sistema')
    default:
      return `${n.type.replace(/_/g, ' ')}${p.serialNumber ? ` · ${String(p.serialNumber)}` : ''}`
  }
}

function toggleUnread(): void {
  unreadOnly.value = !unreadOnly.value
  offset.value = 0
  void load()
}

onMounted(load)
</script>

<template>
  <div class="topbar">
    <div>
      <h1 class="page-title">Notificaciones</h1>
      <p class="page-sub">
        <span v-if="unreadCount > 0">{{ unreadCount }} sin leer</span>
        <span v-else>Todo al día</span>
      </p>
    </div>
    <div class="page-actions">
      <button class="btn" :class="{ 'btn-primary': unreadOnly }" type="button" @click="toggleUnread">
        {{ unreadOnly ? 'Todas' : 'Solo sin leer' }}
      </button>
      <button class="btn" type="button" :disabled="unreadCount === 0" @click="markAllRead">
        Marcar todas como leídas
      </button>
    </div>
  </div>

  <div class="card">
    <div v-if="loading" class="full-center" style="min-height: 120px">
      <span class="spinner spinner-lg" />
    </div>
    <template v-else>
      <div v-if="items.length === 0" class="empty">
        {{ unreadOnly ? 'No hay notificaciones sin leer.' : 'No hay notificaciones.' }}
      </div>
      <ul v-else class="feed">
        <li v-for="n in items" :key="n.id" class="feed-item" :class="{ unread: !n.readAt }" @click="markRead(n)">
          <span class="feed-dot" />
          <div class="feed-body">
            <div>{{ text(n) }}</div>
            <div class="small muted">{{ relativeTime(n.createdAt) }}</div>
          </div>
          <StatusBadge :value="n.type.replace(/_/g, ' ')" />
        </li>
      </ul>
      <Pagination :total="total" :limit="limit" :offset="offset" @page="(o) => { offset = o; load() }" />
    </template>
  </div>
</template>

<style scoped>
.feed {
  list-style: none;
}
.feed-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 4px;
  border-bottom: 1px solid var(--border-soft);
  font-size: 13.5px;
  cursor: pointer;
  border-radius: 6px;
}
.feed-item:hover {
  background: var(--bg-soft);
}
.feed-item:last-child {
  border-bottom: none;
}
.feed-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--border);
  flex-shrink: 0;
}
.feed-item.unread .feed-dot {
  background: var(--gold);
  box-shadow: 0 0 6px rgba(212, 175, 55, 0.6);
}
.feed-item.unread .feed-body {
  font-weight: 600;
}
.feed-body {
  flex: 1;
  min-width: 0;
}
</style>