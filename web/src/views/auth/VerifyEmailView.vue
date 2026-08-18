<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '@/api/client'
import { authApi } from '@/api'

const route = useRoute()
const router = useRouter()

const state = ref<'loading' | 'ok' | 'error'>('loading')
const message = ref('')

onMounted(async () => {
  const token = typeof route.params.token === 'string' ? route.params.token : ''
  try {
    const res = await authApi.verifyEmail(token)
    state.value = 'ok'
    message.value = res.verified
      ? 'Tu email fue verificado correctamente. Ya podés iniciar sesión.'
      : 'La verificación no pudo completarse.'
  } catch (err) {
    state.value = 'error'
    message.value = err instanceof ApiError ? err.message : 'Error inesperado'
  }
})

async function goLogin(): Promise<void> {
  await router.push({ name: 'login' })
}
</script>

<template>
  <div class="auth-shell">
    <div class="auth-card">
      <div class="logo-row">
        <img src="/favicon.svg" alt="" />
        <span>NEAGOLD</span>
      </div>
      <div class="full-center" style="min-height: 160px">
        <span v-if="state === 'loading'" class="spinner spinner-lg" />
        <template v-else>
          <h1 class="auth-title" :class="{ error: state === 'error' }">{{ message }}</h1>
          <button class="btn btn-primary btn-block" type="button" @click="goLogin">
            Ir a iniciar sesión
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.error {
  color: var(--red);
}
</style>