<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

const auth = useAuthStore()
const toast = useToastStore()
const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const busy = ref(false)
const error = ref('')

async function submit(): Promise<void> {
  if (!email.value || !password.value) {
    error.value = 'Completá email y contraseña'
    return
  }
  busy.value = true
  error.value = ''
  try {
    await auth.login(email.value, password.value)
    toast.success('Sesión iniciada')
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    await router.push(redirect)
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Error inesperado'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="auth-shell">
    <div class="auth-card">
      <div class="logo-row">
        <img src="/favicon.svg" alt="" />
        <span>NEAGOLD</span>
      </div>
      <h1 class="auth-title">Iniciar sesión</h1>
      <form @submit.prevent="submit">
        <div class="field">
          <label for="email">Email</label>
          <input
            id="email"
            v-model="email"
            class="input"
            type="email"
            autocomplete="email"
            placeholder="tucorreo@ejemplo.com"
          />
        </div>
        <div class="field">
          <label for="password">Contraseña</label>
          <input
            id="password"
            v-model="password"
            class="input"
            type="password"
            autocomplete="current-password"
            placeholder="••••••••"
          />
        </div>
        <p v-if="error" class="form-error">{{ error }}</p>
        <button class="btn btn-primary btn-block" type="submit" :disabled="busy">
          <span v-if="busy" class="spinner" />{{ busy ? 'Ingresando…' : 'Ingresar' }}
        </button>
      </form>
      <div class="auth-switch">
        ¿No tenés cuenta? <router-link :to="{ name: 'register' }">Registrate</router-link>
      </div>
      <div class="auth-switch">
        <router-link :to="{ name: 'forgot-password' }">Olvidé mi contraseña</router-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
.form-error {
  color: var(--red);
  font-size: 13px;
  margin: -6px 0 12px;
}
</style>