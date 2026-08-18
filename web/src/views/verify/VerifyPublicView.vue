<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ApiError } from '@/api/client'
import { verifyApi } from '@/api'
import StatusBadge from '@/components/StatusBadge.vue'
import { formatDate } from '@/utils/format'
import type { VerifyResponse } from '@/api/types'

const route = useRoute()
const token = typeof route.params.token === 'string' ? route.params.token : ''

const state = ref<'loading' | 'ok' | 'error'>('loading')
const data = ref<VerifyResponse | null>(null)
const message = ref('')

onMounted(async () => {
  try {
    data.value = await verifyApi.check(token)
    state.value = 'ok'
  } catch (err) {
    state.value = 'error'
    message.value = err instanceof ApiError ? err.message : 'No se pudo verificar la pieza'
  }
})
</script>

<template>
  <div class="auth-shell">
    <div class="auth-card verify-card">
      <div class="logo-row">
        <img src="/favicon.svg" alt="" />
        <span>NEAGOLD</span>
      </div>

      <div v-if="state === 'loading'" class="full-center" style="min-height: 200px">
        <span class="spinner spinner-lg" />
        <p class="muted">Verificando identidad digital…</p>
      </div>

      <div v-else-if="state === 'error'" class="full-center" style="min-height: 200px">
        <span class="verify-x">✕</span>
        <h1 class="auth-title">No se pudo verificar</h1>
        <p class="muted center small">{{ message }}</p>
        <p class="small muted center mt-8">
          Si compraste esta pieza, contactá al vendedor o escribinos y revisaremos el registro.
        </p>
      </div>

      <template v-else-if="data">
        <div class="verify-ok">
          <span class="verify-check">✓</span>
          <h1 class="auth-title">Identidad digital verificada</h1>
        </div>

        <h2 class="section">Pieza</h2>
        <dl class="kv">
          <dt>Serial</dt>
          <dd class="mono">{{ data.piece.serialNumber }}</dd>
          <dt>ID público</dt>
          <dd class="mono">{{ data.piece.publicId }}</dd>
          <dt>Material</dt>
          <dd>{{ data.piece.material }}</dd>
          <dt>Pureza</dt>
          <dd>{{ data.piece.purity }}</dd>
          <dt>Peso</dt>
          <dd>{{ data.piece.weightGrams }} g</dd>
          <dt>Fabricación</dt>
          <dd>{{ formatDate(data.piece.manufacturingDate) }}</dd>
          <dt>Estado</dt>
          <dd><StatusBadge :value="data.piece.status" /></dd>
        </dl>

        <h2 class="section">Producto</h2>
        <dl class="kv">
          <dt>SKU</dt>
          <dd class="mono">{{ data.product.sku }}</dd>
          <dt>Nombre</dt>
          <dd>{{ data.product.name }}</dd>
          <dt>Categoría</dt>
          <dd>{{ data.product.category }}</dd>
          <dt>Pureza base</dt>
          <dd>{{ data.product.basePurity }}</dd>
        </dl>

        <h2 class="section">Identidad</h2>
        <dl class="kv">
          <dt>Registrada</dt>
          <dd>{{ formatDate(data.identity.registeredAt) }}</dd>
          <dt>Propiedad</dt>
          <dd>
            <span v-if="data.ownership.registered" class="badge badge-green">Registrada</span>
            <span v-else class="badge badge-gray">Sin propietario registrado</span>
          </dd>
          <dt>Propietario</dt>
          <dd>{{ data.ownership.ownerName ?? '—' }}</dd>
        </dl>

        <p class="small muted mt-16 center">
          Este certificado confirma la autenticidad y la procedencia de la pieza dentro de la plataforma NEAGOLD.
        </p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.verify-card {
  max-width: 460px;
}
.verify-ok {
  text-align: center;
}
.verify-check {
  display: inline-flex;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgba(63, 185, 127, 0.15);
  color: var(--green);
  font-size: 22px;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
}
.verify-x {
  display: inline-flex;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgba(224, 91, 91, 0.15);
  color: var(--red);
  font-size: 20px;
  align-items: center;
  justify-content: center;
}
.section {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--gold);
  margin: 18px 0 8px;
}
.center {
  text-align: center;
}
</style>