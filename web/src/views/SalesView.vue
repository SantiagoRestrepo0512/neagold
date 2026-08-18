<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ApiError } from '@/api/client'
import { piecesApi, salesApi, usersApi } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import UiModal from '@/components/UiModal.vue'
import Pagination from '@/components/Pagination.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import Ic from '@/components/Ic.vue'
import { formatDate, formatMoney } from '@/utils/format'
import type { PieceListItem, SaleItem } from '@/api/types'

const auth = useAuthStore()
const toast = useToastStore()

const items = ref<SaleItem[]>([])
const total = ref(0)
const limit = 12
const offset = ref(0)
const loading = ref(true)
const canCreate = auth.hasPerm('sales:create')

const showCreate = ref(false)
const creating = ref(false)
const form = reactive({ pieceId: '', buyerId: '', amount: '', saleDate: '' })
const pieces = ref<PieceListItem[]>([])
const buyers = ref<{ id: string; email: string; firstName: string; lastName: string }[]>([])
const buyerSearch = ref('')
const formError = ref('')
const result = ref<{ invoiceNumber: string; claimCode: string; claimExpiresAt: string } | null>(null)

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await salesApi.list({ limit, offset: offset.value })
    items.value = res.items
    total.value = res.total
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudieron cargar las ventas')
  } finally {
    loading.value = false
  }
}

async function openCreate(): Promise<void> {
  formError.value = ''
  result.value = null
  Object.assign(form, { pieceId: '', buyerId: '', amount: '', saleDate: '' })
  try {
    const [p, u] = await Promise.all([
      piecesApi.list({ limit: 100, status: 'AVAILABLE' }),
      usersApi.listActive()
    ])
    if (p.items.length === 0) {
      const stock = await piecesApi.list({ limit: 100, status: 'IN_STOCK' })
      pieces.value = stock.items
    } else {
      pieces.value = p.items
    }
    buyers.value = u
    showCreate.value = true
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudo preparar la venta')
  }
}

async function searchBuyers(): Promise<void> {
  try {
    buyers.value = await usersApi.listActive(buyerSearch.value || undefined)
  } catch {
    // el campo queda vacío si no puede buscar
  }
}

const availableBuyers = () => buyers.value

async function createSale(): Promise<void> {
  formError.value = ''
  if (!form.pieceId || !form.buyerId || !form.amount) {
    formError.value = 'Completá pieza, comprador y monto'
    return
  }
  creating.value = true
  try {
    const res = await salesApi.create({
      pieceId: form.pieceId,
      buyerId: form.buyerId,
      amount: form.amount,
      saleDate: form.saleDate || undefined
    })
    result.value = {
      invoiceNumber: res.sale.invoiceNumber,
      claimCode: res.claimCode,
      claimExpiresAt: res.claimExpiresAt
    }
    toast.success('Venta registrada')
    await load()
  } catch (err) {
    formError.value = err instanceof ApiError ? err.message : 'Error inesperado'
  } finally {
    creating.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="topbar">
    <div>
      <h1 class="page-title">Ventas</h1>
      <p class="page-sub">Registrá ventas y emití códigos de garantía</p>
    </div>
    <div class="page-actions">
      <button v-if="canCreate" class="btn btn-primary" type="button" @click="openCreate">
        <Ic name="plus" class="btn-ico" /> Nueva venta
      </button>
    </div>
  </div>

  <div class="card">
    <div v-if="loading" class="full-center" style="min-height: 120px">
      <span class="spinner spinner-lg" />
    </div>
    <template v-else>
      <div v-if="items.length === 0" class="empty">Sin ventas registradas.</div>
      <div v-else class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Factura</th>
              <th>Fecha</th>
              <th>Pieza</th>
              <th>Comprador</th>
              <th>Monto</th>
              <th>Garantía</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in items" :key="s.id">
              <td class="mono">{{ s.invoiceNumber }}</td>
              <td class="muted">{{ formatDate(s.saleDate) }}</td>
              <td class="mono">{{ s.piece.serialNumber }}</td>
              <td>{{ `${s.buyer.firstName} ${s.buyer.lastName}` }}</td>
              <td>{{ formatMoney(s.amount) }}</td>
              <td><StatusBadge :value="s.claimCode.status" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <Pagination :total="total" :limit="limit" :offset="offset" @page="(o) => { offset = o; load() }" />
    </template>
  </div>

  <UiModal v-if="showCreate" title="Nueva venta" @close="showCreate = false">
    <div v-if="result" class="result-box">
      <h3 class="gold">¡Venta registrada!</h3>
      <p class="muted">Factura: <code class="inline">{{ result.invoiceNumber }}</code></p>
      <p>
        Código de garantía del comprador:
      </p>
      <p class="claim-code mono">{{ result.claimCode }}</p>
      <p class="small muted">Vence el {{ formatDate(result.claimExpiresAt) }}. El comprador podrá canjearlo desde su cuenta una sola vez.</p>
      <button class="btn btn-primary btn-block mt-16" type="button" @click="showCreate = false">
        Cerrar
      </button>
    </div>

    <form v-else @submit.prevent="createSale">
      <div class="field">
        <label for="pieceId">Pieza (disponible)</label>
        <select id="pieceId" v-model="form.pieceId" class="select">
          <option value="" disabled>Seleccionar pieza…</option>
          <option v-for="p in pieces" :key="p.id" :value="p.id">
            {{ p.serialNumber }} — {{ p.product.name }} ({{ p.weightGrams }} g)
          </option>
        </select>
      </div>
      <div class="field">
        <label for="buyerSearch">Buscar comprador</label>
        <div class="flex gap-8">
          <input
            id="buyerSearch"
            v-model="buyerSearch"
            class="input"
            placeholder="Email o nombre…"
            @keyup.enter.prevent="searchBuyers"
          />
          <button class="btn" type="button" @click="searchBuyers">Buscar</button>
        </div>
      </div>
      <div class="field">
        <label for="buyerId">Comprador</label>
        <select id="buyerId" v-model="form.buyerId" class="select">
          <option value="" disabled>Seleccionar comprador…</option>
          <option v-for="b in availableBuyers()" :key="b.id" :value="b.id">
            {{ `${b.firstName} ${b.lastName}` }} — {{ b.email }}
          </option>
        </select>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="amount">Monto</label>
          <input id="amount" v-model="form.amount" class="input" placeholder="Ej: 125000.50" />
        </div>
        <div class="field">
          <label for="saleDate">Fecha de venta</label>
          <input id="saleDate" v-model="form.saleDate" class="input" type="date" />
        </div>
      </div>
      <p v-if="formError" class="form-error">{{ formError }}</p>
      <div class="flex gap-8 mt-16 right">
        <button class="btn" type="button" @click="showCreate = false">Cancelar</button>
        <button class="btn btn-primary" type="submit" :disabled="creating">
          <span v-if="creating" class="spinner" /> Registrar venta
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
}
.result-box .gold {
  color: var(--gold-light);
  margin-bottom: 10px;
}
.claim-code {
  font-size: 20px;
  font-weight: 700;
  color: var(--gold-light);
  background: var(--bg-input);
  border: 1px dashed var(--gold-dark);
  border-radius: 8px;
  padding: 12px;
  margin: 10px 0;
}
</style>