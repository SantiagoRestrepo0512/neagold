<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ApiError } from '@/api/client'
import { incidentsApi, piecesApi } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import UiModal from '@/components/UiModal.vue'
import Pagination from '@/components/Pagination.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import Ic from '@/components/Ic.vue'
import { formatDate, fullName } from '@/utils/format'
import type { IncidentItem, IncidentType, PieceListItem } from '@/api/types'

const auth = useAuthStore()
const toast = useToastStore()

const items = ref<IncidentItem[]>([])
const total = ref(0)
const limit = 12
const offset = ref(0)
const type = ref('')
const status = ref('')
const loading = ref(true)
const canCreate = auth.hasPerm('incidents:create')
const canReview = auth.hasPerm('incidents:review')
const canRecover = auth.hasPerm('incidents:recover')
const canResolve = auth.hasPerm('incidents:resolve')

const IDIOT_TYPES: { value: IncidentType; label: string }[] = [
  { value: 'STOLEN', label: 'Robo' },
  { value: 'LOST', label: 'Pérdida' },
  { value: 'FRAUD', label: 'Fraude' },
  { value: 'OTHER', label: 'Otro' }
]
const STATUSES = ['ACTIVE', 'UNDER_REVIEW', 'RECOVERED', 'RESOLVED']

const showCreate = ref(false)
const creating = ref(false)
const form = reactive({ pieceId: '', type: 'STOLEN' as IncidentType, description: '', details: '' })
const pieces = ref<PieceListItem[]>([])
const formError = ref('')

const detail = ref<IncidentItem | null>(null)
const showDetail = ref(false)
const newReport = ref('')
const busy = ref(false)

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await incidentsApi.list({
      type: type.value ? (type.value as IncidentType) : undefined,
      status: status.value || undefined,
      limit,
      offset: offset.value
    })
    items.value = res.items
    total.value = res.total
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudieron cargar los incidentes')
  } finally {
    loading.value = false
  }
}

function onFilter(): void {
  offset.value = 0
  void load()
}

async function openCreate(): Promise<void> {
  formError.value = ''
  Object.assign(form, { pieceId: '', type: 'STOLEN', description: '', details: '' })
  try {
    const res = await piecesApi.list({ limit: 100 })
    pieces.value = res.items
    showCreate.value = true
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudo cargar el listado de piezas')
  }
}

async function report(): Promise<void> {
  formError.value = ''
  if (!form.pieceId) {
    formError.value = 'Seleccioná la pieza'
    return
  }
  creating.value = true
  try {
    await incidentsApi.create({
      pieceId: form.pieceId,
      type: form.type,
      description: form.description.trim() || undefined,
      details: form.details.trim() || undefined
    })
    toast.success('Incidente reportado')
    showCreate.value = false
    await load()
  } catch (err) {
    formError.value = err instanceof ApiError ? err.message : 'Error inesperado'
  } finally {
    creating.value = false
  }
}

async function openDetail(id: string): Promise<void> {
  busy.value = true
  try {
    detail.value = await incidentsApi.detail(id)
    newReport.value = ''
    showDetail.value = true
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudo cargar el incidente')
  } finally {
    busy.value = false
  }
}

async function addReport(): Promise<void> {
  if (!detail.value) return
  busy.value = true
  try {
    detail.value = await incidentsApi.addReport(detail.value.id, newReport.value.trim() || undefined)
    newReport.value = ''
    toast.success('Reporte agregado')
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudo agregar el reporte')
  } finally {
    busy.value = false
  }
}

async function detailAction(action: 'review' | 'recover' | 'resolve'): Promise<void> {
  if (!detail.value) return
  busy.value = true
  try {
    const fn = { review: incidentsApi.review, recover: incidentsApi.recover, resolve: incidentsApi.resolve }[action]
    detail.value = await fn(detail.value.id)
    toast.success('Incidente actualizado')
    await load()
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudo actualizar el incidente')
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="topbar">
    <div>
      <h1 class="page-title">Incidentes</h1>
      <p class="page-sub">Robo, pérdida o fraude de piezas: reporte y resolución</p>
    </div>
    <div class="page-actions">
      <select v-model="type" class="select select-sm" @change="onFilter">
        <option value="">Todos los tipos</option>
        <option v-for="t in IDIOT_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
      </select>
      <select v-model="status" class="select select-sm" @change="onFilter">
        <option value="">Todos los estados</option>
        <option v-for="s in STATUSES" :key="s" :value="s">{{ s.replace(/_/g, ' ') }}</option>
      </select>
      <button v-if="canCreate" class="btn btn-primary" type="button" @click="openCreate">
        <Ic name="alert" class="btn-ico" /> Reportar incidente
      </button>
    </div>
  </div>

  <div class="card">
    <div v-if="loading" class="full-center" style="min-height: 120px">
      <span class="spinner spinner-lg" />
    </div>
    <template v-else>
      <div v-if="items.length === 0" class="empty">Sin incidentes.</div>
      <div v-else class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Pieza</th>
              <th>Tipo</th>
              <th>Estado</th>
              <th>Reportado por</th>
              <th>Fecha</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in items" :key="i.id" class="row-link" @click="openDetail(i.id)">
              <td class="mono">{{ i.piece.serialNumber }}</td>
              <td>{{ i.type }}</td>
              <td><StatusBadge :value="i.status" /></td>
              <td>{{ fullName(i.reporter.firstName, i.reporter.lastName) }}</td>
              <td class="muted">{{ formatDate(i.reportedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <Pagination :total="total" :limit="limit" :offset="offset" @page="(o) => { offset = o; load() }" />
    </template>
  </div>

  <UiModal v-if="showCreate" title="Reportar incidente" @close="showCreate = false">
    <form @submit.prevent="report">
      <div class="field">
        <label for="ipiece">Pieza</label>
        <select id="ipiece" v-model="form.pieceId" class="select">
          <option value="" disabled>Seleccionar pieza…</option>
          <option v-for="p in pieces" :key="p.id" :value="p.id">
            {{ p.serialNumber }} — {{ p.product.name }}
          </option>
        </select>
      </div>
      <div class="field">
        <label for="itype">Tipo</label>
        <select id="itype" v-model="form.type" class="select">
          <option v-for="t in IDIOT_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
        </select>
      </div>
      <div class="field">
        <label for="idesc">Descripción</label>
        <textarea id="idesc" v-model="form.description" class="textarea" placeholder="Qué ocurrió…" />
      </div>
      <div class="field">
        <label for="idetails">Detalles del primer reporte</label>
        <textarea id="idetails" v-model="form.details" class="textarea" placeholder="Circunstancias, fechas, lugares…" />
      </div>
      <p v-if="formError" class="form-error">{{ formError }}</p>
      <div class="flex gap-8 mt-16 right">
        <button class="btn" type="button" @click="showCreate = false">Cancelar</button>
        <button class="btn btn-primary" type="submit" :disabled="creating">
          <span v-if="creating" class="spinner" /> Reportar
        </button>
      </div>
    </form>
  </UiModal>

  <UiModal v-if="showDetail && detail" title="Incidente" @close="showDetail = false">
    <div class="detail-head">
      <div>
        <span class="mono">{{ detail.piece.serialNumber }}</span>
        <span class="muted small"> · {{ detail.type }}</span>
      </div>
      <StatusBadge :value="detail.status" />
    </div>
    <dl class="kv">
      <dt>Reportado por</dt>
      <dd>{{ fullName(detail.reporter.firstName, detail.reporter.lastName) }}</dd>
      <dt>Fecha</dt>
      <dd>{{ formatDate(detail.reportedAt) }}</dd>
      <dt>Descripción</dt>
      <dd>{{ detail.description ?? '—' }}</dd>
    </dl>

    <div class="reports">
      <h3 class="muted mb-16" style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em">
        Reportes de seguimiento
      </h3>
      <div v-if="detail.reports.length === 0" class="empty" style="padding: 12px">Sin reportes de seguimiento.</div>
      <div v-for="r in detail.reports" :key="r.id" class="report">
        <div class="flex-between">
          <span class="mono small">{{ r.reportNumber }}</span>
          <StatusBadge :value="r.status" />
        </div>
        <p class="small">{{ r.details ?? 'Sin detalles' }}</p>
        <p class="small muted">{{ formatDate(r.createdAt) }}</p>
      </div>
    </div>

    <form class="flex gap-8" @submit.prevent="addReport">
      <input v-model="newReport" class="input" placeholder="Nuevo reporte de seguimiento…" />
      <button class="btn btn-primary" type="submit" :disabled="busy || !newReport.trim()">Agregar</button>
    </form>

    <div class="flex gap-8 mt-16 right">
      <button v-if="canReview && ['ACTIVE'].includes(detail.status)" class="btn" type="button" :disabled="busy" @click="detailAction('review')">
        Pasar a revisión
      </button>
      <button v-if="canRecover && ['ACTIVE', 'UNDER_REVIEW'].includes(detail.status)" class="btn" type="button" :disabled="busy" @click="detailAction('recover')">
        Marcar recuperado
      </button>
      <button v-if="canResolve && ['ACTIVE', 'UNDER_REVIEW'].includes(detail.status)" class="btn btn-primary" type="button" :disabled="busy" @click="detailAction('resolve')">
        Resolver
      </button>
    </div>
  </UiModal>
</template>

<style scoped>
.btn-ico {
  width: 14px;
  height: 14px;
}
.row-link {
  cursor: pointer;
}
.form-error {
  color: var(--red);
  font-size: 13px;
  margin: -6px 0 12px;
}
.detail-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}
.reports {
  margin: 14px 0;
}
.report {
  background: var(--bg-soft);
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 8px;
}
</style>