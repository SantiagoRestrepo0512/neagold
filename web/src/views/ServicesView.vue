<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ApiError } from '@/api/client'
import { piecesApi, servicesApi } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import UiModal from '@/components/UiModal.vue'
import Pagination from '@/components/Pagination.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import Ic from '@/components/Ic.vue'
import { formatDate, fullName } from '@/utils/format'
import type { PieceListItem, ServiceRecord, ServiceType } from '@/api/types'

const auth = useAuthStore()
const toast = useToastStore()

const items = ref<ServiceRecord[]>([])
const total = ref(0)
const limit = 12
const offset = ref(0)
const loading = ref(true)
const canRequest = auth.hasPerm('services:request')
const canStart = auth.hasPerm(['services:create', 'services:complete'])
const canComplete = auth.hasPerm('services:complete')
const busyId = ref('')

const TYPES: { value: ServiceType; label: string }[] = [
  { value: 'CLEANING', label: 'Limpieza' },
  { value: 'REPAIR', label: 'Reparación' },
  { value: 'RESIZE', label: 'Ajuste de talle' },
  { value: 'COMPONENT_REPLACEMENT', label: 'Cambio de componentes' },
  { value: 'INSPECTION', label: 'Inspección' },
  { value: 'OTHER', label: 'Otro' }
]

const showCreate = ref(false)
const creating = ref(false)
const form = reactive({ pieceId: '', type: 'CLEANING' as ServiceType, notes: '', scheduledAt: '' })
const pieces = ref<PieceListItem[]>([])
const formError = ref('')

function typeLabel(value: ServiceType): string {
  return TYPES.find((t) => t.value === value)?.label ?? value
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await servicesApi.list({ limit, offset: offset.value })
    items.value = res.items
    total.value = res.total
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudieron cargar los servicios')
  } finally {
    loading.value = false
  }
}

async function openCreate(): Promise<void> {
  formError.value = ''
  Object.assign(form, { pieceId: '', type: 'CLEANING', notes: '', scheduledAt: '' })
  try {
    const res = await piecesApi.list({ limit: 100 })
    pieces.value = res.items
    showCreate.value = true
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudo cargar el listado de piezas')
  }
}

async function requestService(): Promise<void> {
  formError.value = ''
  if (!form.pieceId) {
    formError.value = 'Seleccioná la pieza'
    return
  }
  creating.value = true
  try {
    await servicesApi.create({
      pieceId: form.pieceId,
      type: form.type,
      notes: form.notes.trim() || undefined,
      scheduledAt: form.scheduledAt || undefined
    })
    toast.success('Servicio solicitado')
    showCreate.value = false
    await load()
  } catch (err) {
    formError.value = err instanceof ApiError ? err.message : 'Error inesperado'
  } finally {
    creating.value = false
  }
}

async function run(id: string, action: 'start' | 'complete' | 'cancel', label: string): Promise<void> {
  busyId.value = id
  try {
    const fn = { start: servicesApi.start, complete: servicesApi.complete, cancel: servicesApi.cancel }[action]
    await fn(id)
    toast.success(label)
    await load()
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudo actualizar el servicio')
  } finally {
    busyId.value = ''
  }
}

function canCancel(s: ServiceRecord): boolean {
  if (s.status !== 'REQUESTED') return false
  if (canStart) return true
  return canRequest && s.requestedBy?.id === auth.user?.id
}

onMounted(load)
</script>

<template>
  <div class="topbar">
    <div>
      <h1 class="page-title">Servicios</h1>
      <p class="page-sub">Limpieza, reparación, ajuste e inspección de piezas</p>
    </div>
    <div class="page-actions">
      <button v-if="canRequest || canStart" class="btn btn-primary" type="button" @click="openCreate">
        <Ic name="plus" class="btn-ico" /> Solicitar servicio
      </button>
    </div>
  </div>

  <div class="card">
    <div v-if="loading" class="full-center" style="min-height: 120px">
      <span class="spinner spinner-lg" />
    </div>
    <template v-else>
      <div v-if="items.length === 0" class="empty">Sin servicios.</div>
      <div v-else class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Pieza</th>
              <th>Tipo</th>
              <th>Estado</th>
              <th>Solicitado por</th>
              <th>Fecha</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in items" :key="s.id">
              <td class="mono">{{ s.piece.serialNumber }}</td>
              <td>{{ typeLabel(s.type) }}</td>
              <td><StatusBadge :value="s.status" /></td>
              <td>
                <template v-if="s.requestedBy">{{ fullName(s.requestedBy.firstName, s.requestedBy.lastName) }}</template>
                <span v-else class="muted">—</span>
              </td>
              <td class="muted">{{ formatDate(s.createdAt) }}</td>
              <td class="row-actions">
                <button
                  v-if="canStart && s.status === 'REQUESTED'"
                  class="btn btn-ghost btn-sm"
                  type="button"
                  :disabled="busyId === s.id"
                  @click="run(s.id, 'start', 'Servicio iniciado')"
                >
                  Iniciar
                </button>
                <button
                  v-if="canComplete && ['REQUESTED', 'IN_PROGRESS'].includes(s.status)"
                  class="btn btn-ghost btn-sm"
                  type="button"
                  :disabled="busyId === s.id"
                  @click="run(s.id, 'complete', 'Servicio completado')"
                >
                  Completar
                </button>
                <button
                  v-if="canCancel(s)"
                  class="btn btn-ghost btn-sm danger"
                  type="button"
                  :disabled="busyId === s.id"
                  @click="run(s.id, 'cancel', 'Servicio cancelado')"
                >
                  Cancelar
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Pagination :total="total" :limit="limit" :offset="offset" @page="(o) => { offset = o; load() }" />
    </template>
  </div>

  <UiModal v-if="showCreate" title="Solicitar servicio" @close="showCreate = false">
    <form @submit.prevent="requestService">
      <div class="field">
        <label for="spiece">Pieza</label>
        <select id="spiece" v-model="form.pieceId" class="select">
          <option value="" disabled>Seleccionar pieza…</option>
          <option v-for="p in pieces" :key="p.id" :value="p.id">
            {{ p.serialNumber }} — {{ p.product.name }}
          </option>
        </select>
      </div>
      <div class="field">
        <label for="stype">Tipo de servicio</label>
        <select id="stype" v-model="form.type" class="select">
          <option v-for="t in TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
        </select>
      </div>
      <div class="field">
        <label for="sdate">Fecha programada (opcional)</label>
        <input id="sdate" v-model="form.scheduledAt" type="datetime-local" class="input" />
      </div>
      <div class="field">
        <label for="snotes">Notas (opcional)</label>
        <textarea id="snotes" v-model="form.notes" class="textarea" placeholder="Detalles del servicio…" />
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
.btn-ico {
  width: 14px;
  height: 14px;
}
.form-error {
  color: var(--red);
  font-size: 13px;
  margin: -6px 0 12px;
}
.row-actions {
  text-align: right;
  white-space: nowrap;
}
.danger {
  color: var(--red);
}
</style>