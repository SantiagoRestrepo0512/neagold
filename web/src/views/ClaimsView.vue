<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ApiError } from '@/api/client'
import { claimsApi } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import UiModal from '@/components/UiModal.vue'
import Pagination from '@/components/Pagination.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import Ic from '@/components/Ic.vue'
import { formatDate } from '@/utils/format'
import type { ClaimItem } from '@/api/types'

const auth = useAuthStore()
const toast = useToastStore()

const items = ref<ClaimItem[]>([])
const total = ref(0)
const limit = 12
const offset = ref(0)
const loading = ref(true)
const canRedeem = auth.hasPerm('claims:redeem')

const showRedeem = ref(false)
const code = ref('')
const busy = ref(false)
const error = ref('')
const redeemed = ref<{ serialNumber: string; verifyUrl: string } | null>(null)

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await claimsApi.list({ limit, offset: offset.value })
    items.value = res.items
    total.value = res.total
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudieron cargar las garantías')
  } finally {
    loading.value = false
  }
}

function openRedeem(): void {
  code.value = ''
  error.value = ''
  redeemed.value = null
  showRedeem.value = true
}

async function redeem(): Promise<void> {
  error.value = ''
  busy.value = true
  try {
    const res = await claimsApi.redeem(code.value.trim())
    redeemed.value = { serialNumber: res.piece.serialNumber, verifyUrl: res.verifyUrl }
    toast.success('Garantía canjeada: ya sos propietario de la pieza')
    await load()
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Error inesperado'
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="topbar">
    <div>
      <h1 class="page-title">Garantías</h1>
      <p class="page-sub">Códigos de reclamación de piezas y transferencia de propiedad</p>
    </div>
    <div class="page-actions">
      <button v-if="canRedeem" class="btn btn-primary" type="button" @click="openRedeem">
        <Ic name="key" class="btn-ico" /> Canjear código
      </button>
    </div>
  </div>

  <div class="card">
    <div v-if="loading" class="full-center" style="min-height: 120px">
      <span class="spinner spinner-lg" />
    </div>
    <template v-else>
      <div v-if="items.length === 0" class="empty">Sin garantías registradas.</div>
      <div v-else class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Factura</th>
              <th>Pieza</th>
              <th>Estado</th>
              <th>Vence</th>
              <th>Canjeada</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in items" :key="c.id">
              <td class="mono">{{ c.sale.invoiceNumber }}</td>
              <td class="mono muted">{{ c.pieceId }}</td>
              <td><StatusBadge :value="c.status" /></td>
              <td class="muted">{{ formatDate(c.expiresAt) }}</td>
              <td class="muted">{{ c.usedAt ? formatDate(c.usedAt) : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <Pagination :total="total" :limit="limit" :offset="offset" @page="(o) => { offset = o; load() }" />
    </template>
  </div>

  <UiModal v-if="showRedeem" title="Canjear código de garantía" @close="showRedeem = false">
    <div v-if="redeemed" class="result-box">
      <p>¡Propiedad confirmada de la pieza <strong class="mono">{{ redeemed.serialNumber }}</strong>!</p>
      <p class="small muted mt-8">Podés verificarla públicamente:</p>
      <p class="verify-url mono ellipsis"><a :href="redeemed.verifyUrl" target="_blank" rel="noopener">{{ redeemed.verifyUrl }}</a></p>
      <button class="btn btn-primary btn-block mt-16" type="button" @click="showRedeem = false">Listo</button>
    </div>

    <form v-else @submit.prevent="redeem">
      <div class="field">
        <label for="code">Código</label>
        <input
          id="code"
          v-model="code"
          class="input login-input"
          placeholder="NG-CLAIM-0000-XXXXXXXX"
          autocomplete="off"
          spellcheck="false"
        />
        <p class="hint">Lo recibís al comprar una pieza con garantía.</p>
      </div>
      <p v-if="error" class="form-error">{{ error }}</p>
      <div class="flex gap-8 mt-16 right">
        <button class="btn" type="button" @click="showRedeem = false">Cancelar</button>
        <button class="btn btn-primary" type="submit" :disabled="busy || !code.trim()">
          <span v-if="busy" class="spinner" /> Canjear
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
.result-box {
  text-align: center;
  color: var(--text-muted);
  font-size: 13.5px;
}
.verify-url {
  display: block;
  margin-top: 8px;
  max-width: 100%;
}
</style>