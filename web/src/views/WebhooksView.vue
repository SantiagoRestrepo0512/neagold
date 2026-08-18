<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ApiError } from '@/api/client'
import { webhooksApi, WEBHOOK_EVENTS } from '@/api'
import { useToastStore } from '@/stores/toast'
import UiModal from '@/components/UiModal.vue'
import Pagination from '@/components/Pagination.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { formatDate } from '@/utils/format'
import type { Webhook, WebhookDelivery, WebhookEvent } from '@/api/types'

const toast = useToastStore()

const items = ref<Webhook[]>([])
const total = ref(0)
const limit = 10
const offset = ref(0)
const loading = ref(true)

const showCreate = ref(false)
const creating = ref(false)
const form = reactive({ url: '', events: [] as WebhookEvent[] })
const formError = ref('')
const createdSecret = ref('')

const showEdit = ref(false)
const editing = ref<Webhook | null>(null)
const editForm = reactive({ url: '', isActive: true })

const showSecret = ref('') // diálogo del secreto rotado
const rotatingId = ref('')

const showDeliveries = ref(false)
const deliveries = ref<WebhookDelivery[]>([])
const deliveriesTotal = ref(0)
const deliveriesFor = ref<Webhook | null>(null)
const deliveriesLoading = ref(false)

const deletingId = ref('')

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await webhooksApi.list({ limit, offset: offset.value })
    items.value = res.items
    total.value = res.total
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudieron cargar los webhooks')
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  Object.assign(form, { url: '', events: [] })
  formError.value = ''
  createdSecret.value = ''
  showCreate.value = true
}

async function createWebhook(): Promise<void> {
  formError.value = ''
  if (!form.url.trim() || form.events.length === 0) {
    formError.value = 'Completá la URL y elegí al menos un evento'
    return
  }
  creating.value = true
  try {
    const res = await webhooksApi.create({ url: form.url.trim(), events: form.events })
    createdSecret.value = res.secret
    await load()
  } catch (err) {
    formError.value = err instanceof ApiError ? err.message : 'Error inesperado'
  } finally {
    creating.value = false
  }
}

function openEdit(hook: Webhook): void {
  editing.value = hook
  editForm.url = hook.url
  editForm.isActive = hook.isActive
  showEdit.value = true
}

async function saveEdit(): Promise<void> {
  if (!editing.value) return
  creating.value = true
  try {
    await webhooksApi.update(editing.value.id, {
      url: editForm.url.trim(),
      isActive: editForm.isActive
    })
    toast.success('Webhook actualizado')
    showEdit.value = false
    await load()
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudo actualizar')
  } finally {
    creating.value = false
  }
}

async function rotate(id: string): Promise<void> {
  rotatingId.value = id
  try {
    const res = await webhooksApi.rotateSecret(id)
    showSecret.value = res.secret
    toast.success('Secreto rotado')
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudo rotar el secreto')
  } finally {
    rotatingId.value = ''
  }
}

async function remove(hook: Webhook): Promise<void> {
  deletingId.value = hook.id
  try {
    await webhooksApi.remove(hook.id)
    toast.success('Webhook eliminado')
    await load()
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudo eliminar')
  } finally {
    deletingId.value = ''
  }
}

async function openDeliveries(hook: Webhook): Promise<void> {
  deliveriesFor.value = hook
  showDeliveries.value = true
  deliveriesLoading.value = true
  deliveries.value = []
  deliveriesTotal.value = 0
  try {
    const res = await webhooksApi.deliveries(hook.id, { limit: 20 })
    deliveries.value = res.items
    deliveriesTotal.value = res.total
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudieron cargar las entregas')
  } finally {
    deliveriesLoading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="topbar">
    <div>
      <h1 class="page-title">Webhooks</h1>
      <p class="page-sub">Recibí eventos de la plataforma en tus sistemas vía HTTP firmado</p>
    </div>
    <div class="page-actions">
      <button class="btn btn-primary" type="button" @click="openCreate">+ Nuevo webhook</button>
    </div>
  </div>

  <div class="card">
    <div v-if="loading" class="full-center" style="min-height: 120px">
      <span class="spinner spinner-lg" />
    </div>
    <template v-else>
      <div v-if="items.length === 0" class="empty">
        Sin webhooks configurados. Conectá tu sistema de eventos.
      </div>
      <div v-else class="grid" style="gap: 12px">
        <div v-for="h in items" :key="h.id" class="hook-card">
          <div class="flex-between">
            <div class="hook-url mono ellipsis">{{ h.url }}</div>
            <StatusBadge :value="h.isActive ? 'ACTIVE' : 'INACTIVE'" />
          </div>
          <div class="flex gap-8 mt-8">
            <span v-for="ev in h.events" :key="ev" class="badge badge-gray mono">{{ ev }}</span>
          </div>
          <div class="flex-between hook-meta">
            <span class="small muted">
              {{ h.failureCount > 0 ? `${h.failureCount} fallos consecutivos` : 'Sin fallos' }}
              · última entrega {{ h.lastDeliveryAt ? formatDate(h.lastDeliveryAt) : '—' }}
            </span>
            <div class="flex gap-8">
              <button class="btn btn-sm" type="button" @click="openDeliveries(h)">Entregas</button>
              <button class="btn btn-sm" type="button" :disabled="rotatingId === h.id" @click="rotate(h.id)">
                Rotar secreto
              </button>
              <button class="btn btn-sm" type="button" @click="openEdit(h)">Editar</button>
              <button class="btn btn-sm btn-danger" type="button" :disabled="deletingId === h.id" @click="remove(h)">
                Eliminar
              </button>
            </div>
          </div>
        </div>
      </div>
      <Pagination :total="total" :limit="limit" :offset="offset" @page="(o) => { offset = o; load() }" />
    </template>
  </div>

  <!-- Crear -->
  <UiModal v-if="showCreate" title="Nuevo webhook" @close="showCreate = false">
    <div v-if="createdSecret" class="secret-box">
      <h3 class="gold">¡Webhook creado!</h3>
      <p class="small muted">Guardá este secreto ahora: no se mostrará nuevamente.</p>
      <p class="secret mono">{{ createdSecret }}</p>
      <p class="small muted">
        Firmamos cada entrega con <code class="inline">X-Neagold-Signature: sha256=HMAC(secret, body)</code>.
      </p>
      <button class="btn btn-primary btn-block mt-16" type="button" @click="showCreate = false">Entendido</button>
    </div>

    <form v-else @submit.prevent="createWebhook">
      <div class="field">
        <label for="wurl">URL de destino</label>
        <input id="wurl" v-model="form.url" class="input login-input" placeholder="https://tu-sistema.com/hooks/neagold" />
      </div>
      <div class="field">
        <label>Eventos a suscribir</label>
        <div class="events-grid">
          <label v-for="ev in WEBHOOK_EVENTS" :key="ev" class="event-option">
            <input v-model="form.events" :value="ev" type="checkbox" />
            <span class="mono">{{ ev }}</span>
          </label>
        </div>
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

  <!-- Editar -->
  <UiModal v-if="showEdit && editing" title="Editar webhook" @close="showEdit = false">
    <form @submit.prevent="saveEdit">
      <div class="field">
        <label for="eurl">URL de destino</label>
        <input id="eurl" v-model="editForm.url" class="input login-input" />
      </div>
      <div class="field">
        <label class="switch-label">
          <input v-model="editForm.isActive" type="checkbox" />
          Activo (recibe entregas)
        </label>
      </div>
      <div class="flex gap-8 mt-16 right">
        <button class="btn" type="button" @click="showEdit = false">Cancelar</button>
        <button class="btn btn-primary" type="submit" :disabled="creating">Guardar</button>
      </div>
    </form>
  </UiModal>

  <!-- Secreto rotado -->
  <UiModal v-if="showSecret" title="Secreto nuevo" @close="showSecret = ''">
    <p class="small muted">Este es el nuevo secreto. No volverá a mostrarse.</p>
    <p class="secret mono">{{ showSecret }}</p>
    <button class="btn btn-primary btn-block mt-16" type="button" @click="showSecret = ''">Entendido</button>
  </UiModal>

  <!-- Entregas -->
  <UiModal v-if="showDeliveries && deliveriesFor" :title="`Entregas · ${deliveriesFor.url}`" @close="showDeliveries = false">
    <div v-if="deliveriesLoading" class="full-center" style="min-height: 80px">
      <span class="spinner spinner-lg" />
    </div>
    <template v-else>
      <div v-if="deliveries.length === 0" class="empty">Aún no hay entregas registradas.</div>
      <div v-else class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Evento</th>
              <th>Estado</th>
              <th>Intento</th>
              <th>Código</th>
              <th>Error</th>
              <th>Entregada</th>
              <th>Próximo intento</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in deliveries" :key="d.id">
              <td class="mono">{{ d.eventType }}</td>
              <td><StatusBadge :value="d.status" /></td>
              <td>{{ d.attempts }}</td>
              <td class="mono muted">{{ d.statusCode ?? '—' }}</td>
              <td class="ellipsis muted" :title="d.error ?? ''">{{ d.error ?? '—' }}</td>
              <td class="muted">{{ d.deliveredAt ? formatDate(d.deliveredAt) : '—' }}</td>
              <td class="muted">{{ d.nextAttemptAt ? formatDate(d.nextAttemptAt) : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="deliveriesTotal > deliveries.length" class="small muted mt-8">… y {{ deliveriesTotal - deliveries.length }} más.</p>
    </template>
  </UiModal>
</template>

<style scoped>
.hook-card {
  background: var(--bg-soft);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  padding: 14px 16px;
}
.hook-url {
  max-width: 480px;
}
.hook-meta {
  margin-top: 10px;
}
.secret-box {
  text-align: center;
}
.secret-box .gold {
  color: var(--gold-light);
  margin-bottom: 8px;
}
.secret {
  font-size: 13px;
  font-weight: 600;
  background: var(--bg-input);
  border: 1px dashed var(--gold-dark);
  border-radius: 8px;
  padding: 10px;
  margin: 10px 0;
  word-break: break-all;
}
.events-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.event-option {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 6px 8px;
  background: var(--bg-soft);
  border-radius: 6px;
  cursor: pointer;
}
.event-option input {
  accent-color: var(--gold);
}
.switch-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  cursor: pointer;
}
.switch-label input {
  accent-color: var(--gold);
}
.form-error {
  color: var(--red);
  font-size: 13px;
  margin: -6px 0 12px;
}
</style>