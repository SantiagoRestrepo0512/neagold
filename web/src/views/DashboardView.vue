<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { notificationsApi, piecesApi, transfersApi, claimsApi } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { relativeTime, fullName } from '@/utils/format'
import StatusBadge from '@/components/StatusBadge.vue'
import Ic from '@/components/Ic.vue'
import type { NotificationItem } from '@/api/types'

const auth = useAuthStore()

const piecesTotal = ref<number | null>(null)
const incomingTotal = ref<number | null>(null)
const unread = ref<number | null>(null)
const claimsTotal = ref<number | null>(null)
const recent = ref<NotificationItem[]>([])
const loading = ref(true)

onMounted(async () => {
  const tasks: Promise<void>[] = []
  if (auth.hasPerm(['pieces:list', 'pieces:read_own'])) {
    tasks.push(
      piecesApi.list({ limit: 1 }).then((r) => {
        piecesTotal.value = r.total
      }).catch(() => {})
    )
  }
  if (auth.hasPerm(['transfers:accept', 'transfers:reject'])) {
    tasks.push(
      transfersApi.incoming({ limit: 1 }).then((r) => {
        incomingTotal.value = r.total
      }).catch(() => {})
    )
  }
  if (auth.hasPerm('notifications:read_own')) {
    tasks.push(
      notificationsApi
        .list({ limit: 5 })
        .then((r) => {
          unread.value = r.unreadCount
          recent.value = r.items
        })
        .catch(() => {})
    )
  }
  if (auth.hasPerm('claims:read')) {
    tasks.push(
      claimsApi.list({ limit: 1 }).then((r) => {
        claimsTotal.value = r.total
      }).catch(() => {})
    )
  }
  await Promise.all(tasks)
  loading.value = false
})

const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 12) return 'Buenos días'
  if (h < 19) return 'Buenas tardes'
  return 'Buenas noches'
})

function notificationText(n: NotificationItem): string {
  const p = n.payload as Record<string, string | number | undefined>
  switch (n.type) {
    case 'TRANSFER_REQUEST':
      return `Nueva transferencia de ${p.fromName ?? 'usuario'} · pieza ${p.serialNumber ?? ''}`
    case 'TRANSFER_ACCEPTED':
      return `${p.fromName ?? 'El usuario'} aceptó la transferencia de ${p.serialNumber ?? ''}`
    case 'TRANSFER_REJECTED':
      return `${p.toName ?? 'El usuario'} rechazó la transferencia de ${p.serialNumber ?? ''}`
    case 'CLAIM_AVAILABLE':
      return `Código de garantía disponible para ${p.serialNumber ?? 'tu pieza'}`
    case 'PIECE_REPORTED':
      return `Incidente reportado para ${p.serialNumber ?? ''}`
    case 'PIECE_RECOVERED':
      return `La pieza ${p.serialNumber ?? ''} fue recuperada`
    default:
      return n.type.replace(/_/g, ' ').toLowerCase()
  }
}
</script>

<template>
  <div class="topbar">
    <div>
      <h1 class="page-title">{{ greeting }}, {{ auth.user?.firstName }}</h1>
      <p class="page-sub">
        {{
          auth.user?.roles.length
            ? `Sesión de ${fullName(auth.user?.firstName ?? '', auth.user?.lastName ?? '')} · ${auth.user?.roles.join(', ')}`
            : 'Tu espacio de trazabilidad de joyería'
        }}
      </p>
    </div>
  </div>

  <div v-if="loading" class="full-center">
    <span class="spinner spinner-lg" />
  </div>

  <template v-else>
    <div class="grid grid-3 mb-16">
      <div v-if="piecesTotal !== null" class="card stat">
        <Ic name="gem" class="stat-ico" />
        <div>
          <div class="stat-value">{{ piecesTotal }}</div>
          <div class="stat-label">Piezas registradas</div>
        </div>
        <router-link v-if="auth.hasPerm(['pieces:list', 'pieces:read_own'])" class="btn btn-sm" to="/pieces">
          Ver
        </router-link>
      </div>
      <div v-if="incomingTotal !== null" class="card stat">
        <Ic name="transfer" class="stat-ico" />
        <div>
          <div class="stat-value">{{ incomingTotal }}</div>
          <div class="stat-label">Transferencias entrantes</div>
        </div>
        <router-link v-if="auth.hasPerm(['transfers:accept', 'transfers:reject'])" class="btn btn-sm" to="/transfers">
          Ver
        </router-link>
      </div>
      <div v-if="claimsTotal !== null" class="card stat">
        <Ic name="shield" class="stat-ico" />
        <div>
          <div class="stat-value">{{ claimsTotal }}</div>
          <div class="stat-label">Garantías</div>
        </div>
        <router-link v-if="auth.hasPerm(['claims:read', 'claims:redeem'])" class="btn btn-sm" to="/claims">
          Ver
        </router-link>
      </div>
      <div v-if="unread !== null" class="card stat">
        <Ic name="bell" class="stat-ico" />
        <div>
          <div class="stat-value">{{ unread }}</div>
          <div class="stat-label">Notificaciones sin leer</div>
        </div>
        <router-link class="btn btn-sm" to="/notifications">Ver</router-link>
      </div>
    </div>

    <div v-if="recent.length > 0" class="card">
      <div class="card-head">
        <h2>Notificaciones recientes</h2>
        <router-link class="btn btn-sm" to="/notifications">Todas</router-link>
      </div>
      <ul class="feed">
        <li v-for="n in recent" :key="n.id" class="feed-item" :class="{ unread: !n.readAt }">
          <span class="feed-dot" />
          <div class="feed-body">
            <div>{{ notificationText(n) }}</div>
            <div class="small muted">{{ relativeTime(n.createdAt) }}</div>
          </div>
          <StatusBadge :value="n.type.replace(/_/g, ' ')" />
        </li>
      </ul>
    </div>
  </template>
</template>

<style scoped>
.stat {
  display: flex;
  align-items: center;
  gap: 14px;
}
.stat-ico {
  width: 34px;
  height: 34px;
  color: var(--gold);
  opacity: 0.85;
}
.stat-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--gold-light);
}
.stat-label {
  font-size: 12px;
  color: var(--text-muted);
}
.feed {
  list-style: none;
}
.feed-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 4px;
  border-bottom: 1px solid var(--border-soft);
  font-size: 13.5px;
}
.feed-item:last-child {
  border-bottom: none;
}
.feed-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--border);
  flex-shrink: 0;
}
.feed-item.unread .feed-dot {
  background: var(--gold);
  box-shadow: 0 0 6px rgba(212, 175, 55, 0.6);
}
.feed-body {
  flex: 1;
  min-width: 0;
}
</style>