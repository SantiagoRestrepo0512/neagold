<script setup lang="ts">
import { ref } from 'vue'
import { ApiError } from '@/api/client'
import { authApi } from '@/api'

const email = ref('')
const busy = ref(false)
const error = ref('')
const sent = ref(false)

async function submit(): Promise<void> {
  if (!email.value) {
    error.value = 'Ingresá tu email'
    return
  }
  busy.value = true
  error.value = ''
  try {
    await authApi.forgotPassword(email.value)
    sent.value = true
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
      <h1 class="auth-title">Recuperar contraseña</h1>

      <p v-if="sent" class="done">
        Si el email existe, te enviamos un enlace para restablecer tu contraseña.
        <router-link :to="{ name: 'login' }" class="mt-8 block">Volver al inicio de sesión</router-link>
      </p>

      <form v-else @submit.prevent="submit">
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
          <p class="hint">Te enviaremos un enlace para restablecer tu contraseña.</p>
        </div>
        <p v-if="error" class="form-error">{{ error }}</p>
        <button class="btn btn-primary btn-block" type="submit" :disabled="busy">
          <span v-if="busy" class="spinner" />Enviar enlace
        </button>
      </form>
      <div class="auth-switch">
        <router-link :to="{ name: 'login' }">← Volver al inicio de sesión</router-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
.done {
  color: var(--text-muted);
  font-size: 13.5px;
  line-height: 1.6;
}
.form-error {
  color: var(--red);
  font-size: 13px;
  margin: -6px 0 12px;
}
.block {
  display: block;
}
</style>