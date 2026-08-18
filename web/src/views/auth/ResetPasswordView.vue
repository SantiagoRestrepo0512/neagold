<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '@/api/client'
import { authApi } from '@/api'
import { useToastStore } from '@/stores/toast'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()

const password = ref('')
const confirm = ref('')
const busy = ref(false)
const error = ref('')
const done = ref(false)

async function submit(): Promise<void> {
  error.value = ''
  if (password.value.length < 12) {
    error.value = 'La contraseña debe tener al menos 12 caracteres'
    return
  }
  if (password.value !== confirm.value) {
    error.value = 'Las contraseñas no coinciden'
    return
  }
  busy.value = true
  try {
    const token = typeof route.params.token === 'string' ? route.params.token : ''
    await authApi.resetPassword(token, password.value)
    done.value = true
    toast.success('Contraseña actualizada. Ya podés iniciar sesión.')
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
      <h1 class="auth-title">Nueva contraseña</h1>

      <div v-if="done" class="done">
        <p>Tu contraseña fue actualizada.</p>
        <button class="btn btn-primary btn-block mt-16" type="button" @click="router.push({ name: 'login' })">
          Iniciar sesión
        </button>
      </div>

      <form v-else @submit.prevent="submit">
        <div class="field">
          <label for="password">Nueva contraseña</label>
          <input
            id="password"
            v-model="password"
            class="input"
            type="password"
            autocomplete="new-password"
            placeholder="Mínimo 12 caracteres"
          />
        </div>
        <div class="field">
          <label for="confirm">Confirmar</label>
          <input id="confirm" v-model="confirm" class="input" type="password" autocomplete="new-password" />
        </div>
        <p v-if="error" class="form-error">{{ error }}</p>
        <button class="btn btn-primary btn-block" type="submit" :disabled="busy">
          <span v-if="busy" class="spinner" />Actualizar contraseña
        </button>
      </form>
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
</style>