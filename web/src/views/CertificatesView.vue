<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ApiError } from '@/api/client'
import { certificatesApi, piecesApi } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import UiModal from '@/components/UiModal.vue'
import Pagination from '@/components/Pagination.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import Ic from '@/components/Ic.vue'
import { formatDate, fullName } from '@/utils/format'
import type { CertificateItem, CertificateType, PieceListItem } from '@/api/types'

const auth = useAuthStore()
const toast = useToastStore()

const items = ref<CertificateItem[]>([])
const total = ref(0)
const limit = 12
const offset = ref(0)
const loading = ref(true)
const canCreate = auth.hasPerm('certificates:create')
const canRevoke = auth.hasPerm('certificates:revoke')
const canDownload = auth.hasPerm(['certificates:download_own', 'certificates:read'])
const isOwnerScope = auth.hasPerm('certificates:read_own') && !auth.hasPerm('certificates:read')

const TYPES: { value: CertificateType; label: string }[] = [
  { value: 'AUTHENTICITY', label: 'Autenticidad' },
  { value: 'APPRAISAL', label: 'Aprecio' },
  { value: 'MAINTENANCE', label: 'Mantenimiento' }
]

const showCreate = ref(false)
const creating = ref(false)
const form = reactive({ pieceId: '', type: 'AUTHENTICITY' as CertificateType })
const pieces = ref<PieceListItem[]>([])
const formError = ref('')
const created = ref<{ certificateNumber: string; documentHash: string } | null>(null)
const busyId = ref('')

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await certificatesApi.list({ limit, offset: offset.value })
    items.value = res.items
    total.value = res.total
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudieron cargar los certificados')
  } finally {
    loading.value = false
  }
}

async function openCreate(): Promise<void> {
  formError.value = ''
  created.value = null
  Object.assign(form, { pieceId: '', type: 'AUTHENTICITY' })
  try {
    const res = await piecesApi.list({ limit: 100 })
    pieces.value = res.items
    showCreate.value = true
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudo cargar el listado de piezas')
  }
}

async function issue(): Promise<void> {
  formError.value = ''
  if (!form.pieceId) {
    formError.value = 'Seleccioná la pieza'
    return
  }
  creating.value = true
  try {
    const res = await certificatesApi.create({ pieceId: form.pieceId, type: form.type })
    created.value = { certificateNumber: res.certificate.certificateNumber, documentHash: res.documentHash }
    toast.success('Certificado emitido')
    await load()
  } catch (err) {
    formError.value = err instanceof ApiError ? err.message : 'Error inesperado'
  } finally {
    creating.value = false
  }
}

async function download(id: string, certificateNumber: string): Promise<void> {
  busyId.value = id
  try {
    const { document: doc, documentHash } = await certificatesApi.download(id)
    const blob = new Blob([doc], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${certificateNumber}.txt`
    anchor.click()
    URL.revokeObjectURL(url)
    toast.success(`Descargado (SHA-256: ${documentHash.slice(0, 16)}…)`)
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudo descargar el certificado')
  } finally {
    busyId.value = ''
  }
}

async function revoke(item: CertificateItem): Promise<void> {
  if (!window.confirm(`¿Revocar el certificado ${item.certificateNumber}?`)) return
  busyId.value = item.id
  try {
    await certificatesApi.revoke(item.id)
    toast.success('Certificado revocado')
    await load()
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudo revocar el certificado')
  } finally {
    busyId.value = ''
  }
}

function typeLabel(value: CertificateType): string {
  return TYPES.find((t) => t.value === value)?.label ?? value
}

onMounted(load)
</script>

<template>
  <div class="topbar">
    <div>
      <h1 class="page-title">Certificados</h1>
      <p class="page-sub">Autenticidad, aprecio y mantenimiento con documento verificable (SHA-256)</p>
    </div>
    <div class="page-actions">
      <button v-if="canCreate" class="btn btn-primary" type="button" @click="openCreate">
        <Ic name="plus" class="btn-ico" /> Emitir certificado
      </button>
    </div>
  </div>

  <div class="card">
    <div v-if="loading" class="full-center" style="min-height: 120px">
      <span class="spinner spinner-lg" />
    </div>
    <template v-else>
      <div v-if="items.length === 0" class="empty">
        Sin certificados{{ isOwnerScope ? ' para tus piezas' : '' }}.
      </div>
      <div v-else class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Número</th>
              <th>Pieza</th>
              <th>Tipo</th>
              <th>Estado</th>
              <th>Emitido por</th>
              <th>Fecha</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in items" :key="c.id">
              <td class="mono">{{ c.certificateNumber }}</td>
              <td class="mono">{{ c.piece.serialNumber }}</td>
              <td>{{ typeLabel(c.type) }}</td>
              <td><StatusBadge :value="c.status" /></td>
              <td>{{ fullName(c.issuedBy.firstName, c.issuedBy.lastName) }}</td>
              <td class="muted">{{ formatDate(c.issuedAt) }}</td>
              <td class="row-actions">
                <button
                  v-if="canDownload && c.status === 'ACTIVE'"
                  class="btn btn-ghost btn-sm"
                  type="button"
                  :disabled="busyId === c.id"
                  @click="download(c.id, c.certificateNumber)"
                >
                  Descargar
                </button>
                <button
                  v-if="canRevoke && c.status === 'ACTIVE'"
                  class="btn btn-ghost btn-sm danger"
                  type="button"
                  :disabled="busyId === c.id"
                  @click="revoke(c)"
                >
                  Revocar
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Pagination :total="total" :limit="limit" :offset="offset" @page="(o) => { offset = o; load() }" />
    </template>
  </div>

  <UiModal v-if="showCreate" title="Emitir certificado" @close="showCreate = false">
    <form v-if="!created" @submit.prevent="issue">
      <div class="field">
        <label for="cpiece">Pieza</label>
        <select id="cpiece" v-model="form.pieceId" class="select">
          <option value="" disabled>Seleccionar pieza…</option>
          <option v-for="p in pieces" :key="p.id" :value="p.id">
            {{ p.serialNumber }} — {{ p.product.name }}
          </option>
        </select>
      </div>
      <div class="field">
        <label for="ctype">Tipo</label>
        <select id="ctype" v-model="form.type" class="select">
          <option v-for="t in TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
        </select>
      </div>
      <p v-if="formError" class="form-error">{{ formError }}</p>
      <div class="flex gap-8 mt-16 right">
        <button class="btn" type="button" @click="showCreate = false">Cancelar</button>
        <button class="btn btn-primary" type="submit" :disabled="creating">
          <span v-if="creating" class="spinner" /> Emitir
        </button>
      </div>
    </form>
    <div v-else>
      <p class="small muted">Certificado emitido. El documento se puede re-hashear con SHA-256 para verificar su integridad:</p>
      <p class="mono small break-word">{{ created.certificateNumber }}</p>
      <p class="mono small break-word">{{ created.documentHash }}</p>
      <div class="flex gap-8 mt-16 right">
        <button class="btn btn-primary" type="button" @click="showCreate = false">Listo</button>
      </div>
    </div>
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
.break-word {
  word-break: break-all;
}
</style>