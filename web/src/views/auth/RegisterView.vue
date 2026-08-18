<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError } from '@/api/client'
import { authApi } from '@/api'
import { useToastStore } from '@/stores/toast'

const router = useRouter()
const toast = useToastStore()

const firstName = ref('')
const lastName = ref('')
const email = ref('')
const password = ref('')
const confirm = ref('')
const busy = ref(false)
const error = ref('')
const done = ref(false)
const devUrl = ref('')

const passwordStrength = computed(() => {
  const p = password.value
  let score = 0
  if (p.length >= 12) score++
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++
  if (/\d/.test(p)) score++
  if (/[^A-Za-z0-9]/.test(p)) score++
  return score
})

const strengthLabel = ['Muy débil', 'Débil', 'Media', 'Buena', 'Excelente']

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
    const res = await authApi.register({
      email: email.value,
      password: password.value,
      firstName: firstName.value,
      lastName: lastName.value
    })
    devUrl.value = res.devVerifyUrl ?? ''
    done.value = true
    toast.success('Cuenta creada. Revisá tu correo para verificarla.')
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
      <h1 class="auth-title">Crear cuenta</h1>

      <div v-if="done" class="done-box">
        <p>Tu cuenta se creó correctamente. Revisá tu bandeja de entrada para verificar tu email.</p>
        <p v-if="devUrl" class="small muted">
          (Modo desarrollo) Verificación: <a :href="devUrl" target="_blank" rel="noopener">{{ devUrl }}</a>
        </p>
        <button class="btn btn-primary btn-block mt-16" type="button" @click="router.push({ name: 'login' })">
          Ir a iniciar sesión
        </button>
      </div>

      <form v-else @submit.prevent="submit">
        <div class="field-row">
          <div class="field">
            <label for="firstName">Nombre</label>
            <input id="firstName" v-model="firstName" class="input" autocomplete="given-name" />
          </div>
          <div class="field">
            <label for="lastName">Apellido</label>
            <input id="lastName" v-model="lastName" class="input" autocomplete="family-name" />
          </div>
        </div>
        <div class="field">
          <label for="email">Email</label>
          <input id="email" v-model="email" class="input" type="email" autocomplete="email" />
        </div>
        <div class="field">
          <label for="password">Contraseña</label>
          <input
            id="password"
            v-model="password"
            class="input"
            type="password"
            autocomplete="new-password"
            placeholder="Mínimo 12 caracteres"
          />
          <div class="strength" :class="`strength-${passwordStrength}`">
            <span>{{ strengthLabel[passwordStrength] }}</span>
            <div class="bar"><i :style="{ width: `${(passwordStrength / 4) * 100}%` }" /></div>
          </div>
        </div>
        <div class="field">
          <label for="confirm">Confirmar contraseña</label>
          <input id="confirm" v-model="confirm" class="input" type="password" autocomplete="new-password" />
        </div>
        <p v-if="error" class="form-error">{{ error }}</p>
        <button class="btn btn-primary btn-block" type="submit" :disabled="busy || !firstName || !lastName || !email">
          <span v-if="busy" class="spinner" />{{ busy ? 'Creando…' : 'Crear cuenta' }}
        </button>
      </form>
      <div class="auth-switch">
        ¿Ya tenés cuenta? <router-link :to="{ name: 'login' }">Iniciá sesión</router-link>
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
.done-box {
  color: var(--text-muted);
  font-size: 13.5px;
  line-height: 1.6;
}
.strength {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: var(--text-faint);
}
.strength .bar {
  flex: 1;
  height: 4px;
  background: var(--border);
  border-radius: 2px;
  overflow: hidden;
}
.strength .bar i {
  display: block;
  height: 100%;
  background: var(--gold);
  transition: width 0.3s;
}
</style>