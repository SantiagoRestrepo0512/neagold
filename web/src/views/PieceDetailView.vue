<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '@/api/client'
import { piecesApi } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import StatusBadge from '@/components/StatusBadge.vue'
import UiModal from '@/components/UiModal.vue'
import { formatDate, fullName } from '@/utils/format'
import type { PieceDetail } from '@/api/types'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const toast = useToastStore()

const piece = ref<PieceDetail | null>(null)
const loading = ref(true)
const error = ref('')

const canUpdateStatus = auth.hasPerm('pieces:update_status')
const canRetire = auth.hasPerm('pieces:retire')
const canRegenerateQr = auth.hasPerm('qr:regenerate')
const canRequestTransfer = auth.hasPerm(['transfers:request', 'transfers:manage'])

const showStatus = ref(false)
const showRetire = ref(false)
const statusTarget = ref('AVAILABLE')
const busy = ref(false)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    piece.value = await piecesApi.detail(String(route.params.id))
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'No se pudo cargar la pieza'
  } finally {
    loading.value = false
  }
}

async function changeStatus(): Promise<void> {
  if (!piece.value) return
  busy.value = true
  try {
    await piecesApi.updateStatus(piece.value.id, statusTarget.value)
    toast.success('Estado actualizado')
    showStatus.value = false
    await load()
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudo actualizar el estado')
  } finally {
    busy.value = false
  }
}

async function retire(): Promise<void> {
  if (!piece.value) return
  busy.value = true
  try {
    await piecesApi.retire(piece.value.id)
    toast.success('Pieza retirada')
    showRetire.value = false
    await load()
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudo retirar la pieza')
  } finally {
    busy.value = false
  }
}

async function regenerateQr(): Promise<void> {
  if (!piece.value) return
  busy.value = true
  try {
    const res = await piecesApi.regenerateQr(piece.value.id)
    toast.success('QR regenerado; el anterior fue revocado')
    await load()
    if (res.verifyUrl) {
      void router.push({ name: 'verify-public', params: { token: res.verifyUrl.split('/').pop() } })
    }
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudo regenerar el QR')
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="topbar">
    <div class="flex gap-8">
      <button class="btn btn-ghost" type="button" @click="router.push('/pieces')">←</button>
      <div>
        <h1 class="page-title">Pieza {{ piece?.serialNumber ?? '…' }}</h1>
        <p class="page-sub">{{ piece?.product.name ?? '' }}</p>
      </div>
    </div>
    <div v-if="piece" class="page-actions">
      <button v-if="canUpdateStatus" class="btn" type="button" @click="showStatus = true">Cambiar estado</button>
      <button v-if="canRegenerateQr" class="btn" type="button" :disabled="busy" @click="regenerateQr">
        Regenerar QR
      </button>
      <button v-if="canRetire && piece.status !== 'RETIRED'" class="btn btn-danger" type="button" @click="showRetire = true">
        Retirar
      </button>
    </div>
  </div>

  <div v-if="loading" class="full-center">
    <span class="spinner spinner-lg" />
  </div>

  <p v-else-if="error" class="empty">{{ error }}</p>

  <template v-else-if="piece">
    <div class="grid grid-2">
      <div class="card">
        <div class="card-head">
          <h2>Datos de la pieza</h2>
          <StatusBadge :value="piece.status" />
        </div>
        <dl class="kv">
          <dt>Serial</dt>
          <dd class="mono">{{ piece.serialNumber }}</dd>
          <dt>ID interno</dt>
          <dd class="mono">{{ piece.internalId }}</dd>
          <dt>ID público</dt>
          <dd class="mono">{{ piece.publicId }}</dd>
          <dt>Producto</dt>
          <dd>{{ piece.product.sku }} — {{ piece.product.name }}</dd>
          <dt>Material</dt>
          <dd>{{ piece.material }}</dd>
          <dt>Pureza</dt>
          <dd>{{ piece.purity }}</dd>
          <dt>Peso</dt>
          <dd>{{ piece.weightGrams }} g</dd>
          <dt>Fabricación</dt>
          <dd>{{ formatDate(piece.manufacturingDate) }}</dd>
          <dt>Registrada</dt>
          <dd>{{ formatDate(piece.createdAt) }}</dd>
        </dl>
      </div>

      <div class="grid" style="gap: 16px">
        <div class="card">
          <div class="card-head"><h2>Identidad digital</h2></div>
          <dl class="kv">
            <dt>Estado</dt>
            <dd>
              <span class="badge" :class="piece.digitalIdentity?.status === 'ACTIVE' ? 'badge-green' : 'badge-red'">
                {{ piece.digitalIdentity?.status ?? 'SIN IDENTIDAD' }}
              </span>
            </dd>
            <dt>Token público</dt>
            <dd class="mono ellipsis">{{ piece.digitalIdentity?.publicToken ?? '—' }}</dd>
            <dt>QR</dt>
            <dd>{{ piece.activeQr ? 'Activo' : '—' }}</dd>
          </dl>
        </div>

        <div class="card">
          <div class="card-head"><h2>Propietario actual</h2></div>
          <template v-if="piece.currentOwner">
            <p class="muted">{{ fullName(piece.currentOwner.firstName, piece.currentOwner.lastName) }}</p>
            <p class="small muted">{{ piece.currentOwner.email }}</p>
          </template>
          <p v-else class="empty" style="padding: 12px">En stock — sin propietario registrado</p>
          <router-link v-if="canRequestTransfer" class="btn btn-primary btn-block mt-16" :to="`/transfers?piece=${piece.id}`">
            Transferir esta pieza
          </router-link>
        </div>
      </div>
    </div>

    <UiModal v-if="showStatus" title="Cambiar estado" @close="showStatus = false">
      <div class="field">
        <label for="newStatus">Nuevo estado</label>
        <select id="newStatus" v-model="statusTarget" class="select">
          <option value="AVAILABLE">Disponible</option>
          <option value="IN_STOCK">En stock</option>
          <option value="IN_SERVICE">En servicio</option>
        </select>
        <p class="hint">Solo se permiten transiciones válidas (IN_STOCK ↔ AVAILABLE, o hacia IN_SERVICE).</p>
      </div>
      <div class="flex gap-8 mt-16 right">
        <button class="btn" type="button" @click="showStatus = false">Cancelar</button>
        <button class="btn btn-primary" type="button" :disabled="busy" @click="changeStatus">
          <span v-if="busy" class="spinner" /> Guardar
        </button>
      </div>
    </UiModal>

    <UiModal v-if="showRetire" title="Retirar pieza" @close="showRetire = false">
      <p class="muted">
        La pieza pasará a estado <strong>RETIRED</strong> y dejará de estar disponible para ventas y transferencias.
        Esta acción no se puede deshacer manualmente.
      </p>
      <div class="flex gap-8 mt-16 right">
        <button class="btn" type="button" @click="showRetire = false">Cancelar</button>
        <button class="btn btn-danger" type="button" :disabled="busy" @click="retire">
          <span v-if="busy" class="spinner" /> Retirar
        </button>
      </div>
    </UiModal>
  </template>
</template>