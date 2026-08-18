<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ApiError } from '@/api/client'
import { piecesApi, productsApi } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import UiModal from '@/components/UiModal.vue'
import Pagination from '@/components/Pagination.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import Ic from '@/components/Ic.vue'
import type { PieceListItem, PieceStatus, Product } from '@/api/types'

const auth = useAuthStore()
const toast = useToastStore()

const PIECE_STATUSES: PieceStatus[] = [
  'IN_STOCK',
  'AVAILABLE',
  'SOLD',
  'IN_SERVICE',
  'REPORTED_STOLEN',
  'LOST',
  'RETIRED'
]

// El backend valida material con /^[A-Z][A-Z0-9_]*$/ (sin espacios): los
// valores del select respetan ese contrato.
const MATERIALS = ['GOLD', 'SILVER', 'PLATINUM', 'GOLD_PLATED', 'SILVER_PLATED', 'BRASS', 'COPPER', 'TITANIUM', 'OTHER']
const PURITIES = ['10K', '14K', '18K', '22K', '24K', '950', '925', '900']

const items = ref<PieceListItem[]>([])
const total = ref(0)
const limit = 12
const offset = ref(0)
const status = ref('')
const search = ref('')
const loading = ref(true)
const canCreate = auth.hasPerm('pieces:create')

const showCreate = ref(false)
const creating = ref(false)
const form = reactive({
  productId: '',
  material: 'GOLD',
  purity: '18K',
  weightGrams: '',
  manufacturingDate: ''
})
const products = ref<Product[]>([])
const formError = ref('')

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await piecesApi.list({
      status: status.value || undefined,
      search: search.value || undefined,
      limit,
      offset: offset.value
    })
    items.value = res.items
    total.value = res.total
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudieron cargar las piezas')
  } finally {
    loading.value = false
  }
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
function onSearch(): void {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    offset.value = 0
    void load()
  }, 350)
}

function onStatus(): void {
  offset.value = 0
  void load()
}

async function openCreate(): Promise<void> {
  formError.value = ''
  Object.assign(form, { productId: '', material: 'GOLD', purity: '18K', weightGrams: '', manufacturingDate: '' })
  try {
    products.value = (await productsApi.list({ limit: 100 })).items
    showCreate.value = true
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudo cargar el catálogo')
  }
}

async function createPiece(): Promise<void> {
  formError.value = ''
  if (!form.productId || !form.weightGrams || !form.manufacturingDate) {
    formError.value = 'Completá producto, peso y fecha de fabricación'
    return
  }
  creating.value = true
  try {
    const res = await piecesApi.create({
      productId: form.productId,
      material: form.material.trim().toUpperCase(),
      purity: form.purity.trim().toUpperCase(),
      weightGrams: form.weightGrams.trim(),
      manufacturingDate: form.manufacturingDate
    })
    toast.success(`Pieza ${res.serialNumber} registrada con su identidad digital`)
    showCreate.value = false
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
      <h1 class="page-title">Piezas</h1>
      <p class="page-sub">Identidad digital y trazabilidad de cada pieza</p>
    </div>
    <div class="page-actions">
      <div class="search-box">
        <Ic name="search" class="search-ico" />
        <input v-model="search" class="input input-sm" placeholder="Buscar por serial, id interno…" @input="onSearch" />
      </div>
      <select v-model="status" class="select select-sm" @change="onStatus">
        <option value="">Todos los estados</option>
        <option v-for="s in PIECE_STATUSES" :key="s" :value="s">{{ s.replace(/_/g, ' ') }}</option>
      </select>
      <button v-if="canCreate" class="btn btn-primary" type="button" @click="openCreate">
        <Ic name="plus" class="btn-ico" /> Registrar pieza
      </button>
    </div>
  </div>

  <div class="card">
    <div v-if="loading" class="full-center" style="min-height: 120px">
      <span class="spinner spinner-lg" />
    </div>
    <template v-else>
      <div v-if="items.length === 0" class="empty">Sin piezas registradas.</div>
      <div v-else class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Serial</th>
              <th>ID interno</th>
              <th>Producto</th>
              <th>Peso</th>
              <th>Pureza</th>
              <th>Material</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in items" :key="p.id" class="row-link" @click="$router.push(`/pieces/${p.id}`)">
              <td><router-link :to="`/pieces/${p.id}`" @click.stop class="mono">{{ p.serialNumber }}</router-link></td>
              <td class="mono muted">{{ p.internalId }}</td>
              <td>{{ p.product.name }}</td>
              <td class="muted">{{ p.weightGrams }} g</td>
              <td>{{ p.purity }}</td>
              <td class="muted">{{ p.material }}</td>
              <td><StatusBadge :value="p.status" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <Pagination :total="total" :limit="limit" :offset="offset" @page="(o) => { offset = o; load() }" />
    </template>
  </div>

  <UiModal v-if="showCreate" title="Registrar pieza" @close="showCreate = false">
    <form @submit.prevent="createPiece">
      <div class="field">
        <label for="productId">Producto</label>
        <select id="productId" v-model="form.productId" class="select">
          <option value="" disabled>Seleccionar producto…</option>
          <option v-for="p in products" :key="p.id" :value="p.id">
            {{ p.sku }} — {{ p.name }}
          </option>
        </select>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="material">Material</label>
          <select id="material" v-model="form.material" class="select">
            <option v-for="m in MATERIALS" :key="m" :value="m">{{ m.replace(/_/g, ' ') }}</option>
          </select>
        </div>
        <div class="field">
          <label for="purity">Pureza</label>
          <select id="purity" v-model="form.purity" class="select">
            <option v-for="p in PURITIES" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="weight">Peso (g)</label>
          <input id="weight" v-model="form.weightGrams" class="input" placeholder="Ej: 8.250" />
        </div>
        <div class="field">
          <label for="mdate">Fecha de fabricación</label>
          <input id="mdate" v-model="form.manufacturingDate" class="input" type="date" />
        </div>
      </div>
      <p class="hint-text">
        Se generará automáticamente su serial, identidad digital y código QR, con URL pública de verificación.
      </p>
      <p v-if="formError" class="form-error">{{ formError }}</p>
      <div class="flex gap-8 mt-16 right">
        <button class="btn" type="button" @click="showCreate = false">Cancelar</button>
        <button class="btn btn-primary" type="submit" :disabled="creating">
          <span v-if="creating" class="spinner" /> Registrar
        </button>
      </div>
    </form>
  </UiModal>
</template>

<style scoped>
.search-box {
  position: relative;
}
.search-ico {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
  color: var(--text-faint);
  pointer-events: none;
}
.search-box .input-sm {
  padding-left: 30px;
  min-width: 210px;
}
.btn-ico {
  width: 14px;
  height: 14px;
}
.row-link {
  cursor: pointer;
}
.hint-text {
  font-size: 12px;
  color: var(--text-faint);
  margin-bottom: 12px;
}
.form-error {
  color: var(--red);
  font-size: 13px;
  margin: -6px 0 12px;
}
</style>