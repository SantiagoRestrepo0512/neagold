<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ApiError } from '@/api/client'
import { piecesApi, transfersApi, usersApi } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import UiModal from '@/components/UiModal.vue'
import Pagination from '@/components/Pagination.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import Ic from '@/components/Ic.vue'
import { formatDate, fullName } from '@/utils/format'
import type { PieceListItem, TransferItem } from '@/api/types'

const auth = useAuthStore()
const toast = useToastStore()
const route = useRoute()

const canManage = auth.hasPerm('transfers:manage')
const canAccept = auth.hasPerm(['transfers:accept', 'transfers:manage'])
const canReject = auth.hasPerm(['transfers:reject', 'transfers:manage'])
const canCancel = auth.hasPerm(['transfers:request', 'transfers:manage'])
const canRequest = auth.hasPerm(['transfers:request', 'transfers:manage'])

const tab = ref<'incoming' | 'outgoing' | 'all'>(canManage ? 'incoming' : 'outgoing')
const items = ref<TransferItem[]>([])
const total = ref(0)
const limit = 12
const offset = ref(0)
const loading = ref(true)
const busyId = ref('')

const showCreate = ref(false)
const creating = ref(false)
const form = reactive({ pieceId: '', toUserId: '' })
const pieces = ref<PieceListItem[]>([])
const users = ref<{ id: string; email: string; firstName: string; lastName: string }[]>([])
const userSearch = ref('')
const formError = ref('')

const loaderMap = {
  incoming: transfersApi.incoming,
  outgoing: transfersApi.outgoing,
  all: transfersApi.all
} as const

const loader = computed(() => loaderMap[tab.value])

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await loader.value({ limit, offset: offset.value })
    items.value = res.items
    total.value = res.total
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudieron cargar las transferencias')
  } finally {
    loading.value = false
  }
}

function switchTab(next: 'incoming' | 'outgoing' | 'all'): void {
  tab.value = next
  offset.value = 0
  void load()
}

async function act(id: string, action: 'accept' | 'reject' | 'cancel'): Promise<void> {
  busyId.value = id
  try {
    const fn = { accept: transfersApi.accept, reject: transfersApi.reject, cancel: transfersApi.cancel }[action]
    const updated = await fn(id)
    toast.success(
      action === 'accept'
        ? 'Transferencia aceptada'
        : action === 'reject'
          ? 'Transferencia rechazada'
          : 'Transferencia cancelada'
    )
    items.value = items.value.map((i) => (i.id === id ? updated : i))
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudo procesar la transferencia')
  } finally {
    busyId.value = ''
  }
}

async function openCreate(): Promise<void> {
  formError.value = ''
  Object.assign(form, { pieceId: '', toUserId: '' })
  try {
    const pieceParam = typeof route.query.piece === 'string' ? route.query.piece : undefined
    const p = await piecesApi.list({ limit: 100 })
    pieces.value = p.items
    if (pieceParam) form.pieceId = pieceParam
    users.value = await usersApi.listActive()
    showCreate.value = true
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudo preparar la transferencia')
  }
}

async function searchUsers(): Promise<void> {
  try {
    users.value = await usersApi.listActive(userSearch.value || undefined)
  } catch {
    // campo vacío si falla la búsqueda
  }
}

async function createTransfer(): Promise<void> {
  formError.value = ''
  if (!form.pieceId || !form.toUserId) {
    formError.value = 'Seleccioná pieza y destinatario'
    return
  }
  creating.value = true
  try {
    await transfersApi.request(form.pieceId, form.toUserId)
    toast.success('Transferencia solicitada')
    showCreate.value = false
    await load()
  } catch (err) {
    formError.value = err instanceof ApiError ? err.message : 'Error inesperado'
  } finally {
    creating.value = false
  }
}

onMounted(() => {
  if (route.query.tab === 'outgoing') tab.value = 'outgoing'
  void load()
})
</script>

<template>
  <div class="topbar">
    <div>
      <h1 class="page-title">Transferencias</h1>
      <p class="page-sub">Traspaso de propiedad entre usuarios de la plataforma</p>
    </div>
    <div class="page-actions">
      <button v-if="canRequest" class="btn btn-primary" type="button" @click="openCreate">
        <Ic name="transfer" class="btn-ico" /> Solicitar transferencia
      </button>
    </div>
  </div>

  <div class="tabs mb-16">
    <button
      class="tab"
      :class="{ active: tab === 'incoming' }"
      type="button"
      :disabled="!canAccept && !canReject"
      @click="switchTab('incoming')"
    >
      Entrantes
    </button>
    <button class="tab" :class="{ active: tab === 'outgoing' }" type="button" @click="switchTab('outgoing')">
      Salientes
    </button>
    <button v-if="canManage" class="tab" :class="{ active: tab === 'all' }" type="button" @click="tab = 'all'; offset = 0; load()">
      Todas
    </button>
  </div>

  <div class="card">
    <div v-if="loading" class="full-center" style="min-height: 120px">
      <span class="spinner spinner-lg" />
    </div>
    <template v-else>
      <div v-if="items.length === 0" class="empty">No hay transferencias {{ tab === 'incoming' ? 'entrantes' : 'salientes' }}.</div>
      <div v-else class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Pieza</th>
              <th>De</th>
              <th>Para</th>
              <th>Estado</th>
              <th>Solicitada</th>
              <th>Vence</th>
              <th class="right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in items" :key="t.id">
              <td class="mono">{{ t.piece.serialNumber }}</td>
              <td>{{ fullName(t.fromUser.firstName, t.fromUser.lastName) }}</td>
              <td>{{ fullName(t.toUser.firstName, t.toUser.lastName) }}</td>
              <td><StatusBadge :value="t.status" /></td>
              <td class="muted">{{ formatDate(t.createdAt) }}</td>
              <td class="muted">{{ formatDate(t.expiresAt) }}</td>
              <td class="right">
                <div class="flex gap-8" style="justify-content: flex-end">
                  <button
                    v-if="tab === 'incoming' && t.status === 'PENDING' && canAccept"
                    class="btn btn-sm btn-primary"
                    type="button"
                    :disabled="busyId === t.id"
                    @click="act(t.id, 'accept')"
                  >
                    Aceptar
                  </button>
                  <button
                    v-if="tab === 'incoming' && t.status === 'PENDING' && canReject"
                    class="btn btn-sm"
                    type="button"
                    :disabled="busyId === t.id"
                    @click="act(t.id, 'reject')"
                  >
                    Rechazar
                  </button>
                  <button
                    v-if="t.status === 'PENDING' && (tab === 'outgoing' ? canCancel : canManage)"
                    class="btn btn-sm btn-ghost"
                    type="button"
                    :disabled="busyId === t.id"
                    @click="act(t.id, 'cancel')"
                  >
                    Cancelar
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Pagination :total="total" :limit="limit" :offset="offset" @page="(o) => { offset = o; load() }" />
    </template>
  </div>

  <UiModal v-if="showCreate" title="Solicitar transferencia" @close="showCreate = false">
    <form @submit.prevent="createTransfer">
      <div class="field">
        <label for="tpiece">Pieza</label>
        <select id="tpiece" v-model="form.pieceId" class="select">
          <option value="" disabled>Seleccionar pieza…</option>
          <option v-for="p in pieces" :key="p.id" :value="p.id">
            {{ p.serialNumber }} — {{ p.product.name }}
          </option>
        </select>
      </div>
      <div class="field">
        <label for="userSearch">Buscar destinatario</label>
        <div class="flex gap-8">
          <input
            id="userSearch"
            v-model="userSearch"
            class="input"
            placeholder="Email o nombre…"
            @keyup.enter.prevent="searchUsers"
          />
          <button class="btn" type="button" @click="searchUsers">Buscar</button>
        </div>
      </div>
      <div class="field">
        <label for="toUser">Destinatario</label>
        <select id="toUser" v-model="form.toUserId" class="select">
          <option value="" disabled>Seleccionar usuario…</option>
          <option v-for="u in users" :key="u.id" :value="u.id">
            {{ `${u.firstName} ${u.lastName}` }} — {{ u.email }}
          </option>
        </select>
        <p class="hint">La transferencia expira a los 7 días si no se acepta.</p>
      </div>
      <p v-if="formError" class="form-error">{{ formError }}</p>
      <div class="flex gap-8 mt-16 right">
        <button class="btn" type="button" @click="showCreate = false">Cancelar</button>
        <button class="btn btn-primary" type="submit" :disabled="creating">
          <span v-if="creating" class="spinner" /> Solicitar
        </button>
      </div>
    </form>
  </UiModal>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 4px;
  background: var(--bg-soft);
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  padding: 4px;
  width: fit-content;
}
.tab {
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 600;
  padding: 7px 16px;
  border-radius: 7px;
}
.tab:hover:not(:disabled) {
  color: var(--text);
}
.tab.active {
  background: var(--bg-card);
  color: var(--gold-light);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}
.tab:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.btn-ico {
  width: 14px;
  height: 14px;
}
.form-error {
  color: var(--red);
  font-size: 13px;
  margin: -6px 0 12px;
}
</style>