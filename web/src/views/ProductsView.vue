<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ApiError } from '@/api/client'
import { productsApi } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import UiModal from '@/components/UiModal.vue'
import Pagination from '@/components/Pagination.vue'
import Ic from '@/components/Ic.vue'
import type { ProductListItem } from '@/api/types'

const auth = useAuthStore()
const toast = useToastStore()

const items = ref<ProductListItem[]>([])
const total = ref(0)
const limit = 10
const offset = ref(0)
const search = ref('')
const loading = ref(true)
const canCreate = auth.hasPerm('products:create')

const showCreate = ref(false)
const creating = ref(false)
const form = reactive({
  sku: '',
  name: '',
  category: '',
  basePurity: '',
  baseWeightGrams: '',
  description: ''
})
const formError = ref('')

async function load(): Promise<void> {
  loading.value = true
  try {
    // Parámetros de paginación saneados: enteros no negativos dentro de rango
    // (limit 1..100) para que la API nunca reciba NaN, null o negativos.
    const safeLimit = Math.min(Math.max(Math.floor(Number(limit)) || 1, 1), 100)
    const safeOffset = Math.max(Math.floor(Number(offset.value)) || 0, 0)
    const res = await productsApi.list({
      search: search.value || undefined,
      limit: safeLimit,
      offset: safeOffset
    })
    items.value = res.items
    total.value = res.total
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudieron cargar los productos')
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

function openCreate(): void {
  Object.assign(form, {
    sku: '',
    name: '',
    category: '',
    basePurity: '',
    baseWeightGrams: '',
    description: ''
  })
  formError.value = ''
  showCreate.value = true
}

async function createProduct(): Promise<void> {
  formError.value = ''
  if (!form.sku.trim() || !form.name.trim() || !form.category.trim() || !form.basePurity.trim()) {
    formError.value = 'Completá SKU, nombre, categoría y pureza base'
    return
  }
  creating.value = true
  try {
    await productsApi.create({
      sku: form.sku.trim(),
      name: form.name.trim(),
      category: form.category.trim(),
      basePurity: form.basePurity.trim(),
      baseWeightGrams: form.baseWeightGrams.trim() || undefined,
      description: form.description.trim() || undefined
    })
    toast.success('Producto creado')
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
      <h1 class="page-title">Catálogo de productos</h1>
      <p class="page-sub">Modelos base: purezas y pesos de referencia para las piezas</p>
    </div>
    <div class="page-actions">
      <div class="search-box">
        <Ic name="search" class="search-ico" />
        <input v-model="search" class="input input-sm" placeholder="Buscar por SKU o nombre…" @input="onSearch" />
      </div>
      <button v-if="canCreate" class="btn btn-primary" type="button" @click="openCreate">
        <Ic name="plus" class="btn-ico" /> Nuevo producto
      </button>
    </div>
  </div>

  <div class="card">
    <div v-if="loading" class="full-center" style="min-height: 120px">
      <span class="spinner spinner-lg" />
    </div>
    <template v-else>
      <div v-if="items.length === 0" class="empty">Sin productos. Cargá tu catálogo para comenzar.</div>
      <div v-else class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Nombre</th>
              <th>Categoría</th>
              <th>Pureza</th>
              <th>Peso base</th>
              <th>Piezas</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in items" :key="p.id">
              <td class="mono">{{ p.sku }}</td>
              <td>{{ p.name }}</td>
              <td class="muted">{{ p.category }}</td>
              <td>{{ p.basePurity }}</td>
              <td class="muted">{{ p.baseWeightGrams ? `${p.baseWeightGrams} g` : '—' }}</td>
              <td>{{ p._count?.pieces ?? 0 }}</td>
              <td>
                <span class="badge" :class="p.isActive ? 'badge-green' : 'badge-gray'">
                  {{ p.isActive ? 'Activo' : 'Inactivo' }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Pagination :total="total" :limit="limit" :offset="offset" @page="(o) => { offset = o; load() }" />
    </template>
  </div>

  <UiModal v-if="showCreate" title="Nuevo producto" @close="showCreate = false">
    <form @submit.prevent="createProduct">
      <div class="field">
        <label for="sku">SKU</label>
        <input id="sku" v-model="form.sku" class="input" placeholder="Ej: ORO-18K-CADENA" />
      </div>
      <div class="field">
        <label for="name">Nombre</label>
        <input id="name" v-model="form.name" class="input" placeholder="Ej: Cadena eslabón 18k" />
      </div>
      <div class="field-row">
        <div class="field">
          <label for="category">Categoría</label>
          <input id="category" v-model="form.category" class="input" placeholder="CADENAS" />
        </div>
        <div class="field">
          <label for="basePurity">Pureza base</label>
          <input id="basePurity" v-model="form.basePurity" class="input" placeholder="18K" />
        </div>
      </div>
      <div class="field">
        <label for="weight">Peso base (g)</label>
        <input id="weight" v-model="form.baseWeightGrams" class="input" placeholder="Ej: 12.500" />
      </div>
      <div class="field">
        <label for="desc">Descripción</label>
        <textarea id="desc" v-model="form.description" class="textarea" />
      </div>
      <p v-if="formError" class="form-error">{{ formError }}</p>
      <div class="flex gap-8 mt-16 right">
        <button class="btn" type="button" @click="showCreate = false">Cancelar</button>
        <button class="btn btn-primary" type="submit" :disabled="creating">
          <span v-if="creating" class="spinner" /> Crear
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
  min-width: 220px;
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