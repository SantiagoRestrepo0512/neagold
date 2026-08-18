<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ApiError } from '@/api/client'
import { usersApi } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'
import { useToastStore } from '@/stores/toast'
import { formatDate } from '@/utils/format'
import type { Session } from '@/api/types'

const auth = useAuthStore()
const router = useRouter()
const toast = useToastStore()

const sessions = ref<Session[]>([])
const saving = ref(false)

const profile = reactive({
  firstName: auth.user?.firstName ?? '',
  lastName: auth.user?.lastName ?? ''
})
const profileError = ref('')

const password = reactive({ current: '', next: '', confirm: '' })
const passwordError = ref('')

async function loadSessions(): Promise<void> {
  try {
    sessions.value = await usersApi.sessions()
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudieron cargar las sesiones')
  }
}

async function saveProfile(): Promise<void> {
  profileError.value = ''
  saving.value = true
  try {
    const updated = await usersApi.updateMe({
      firstName: profile.firstName.trim(),
      lastName: profile.lastName.trim()
    })
    auth.user = updated
    toast.success('Perfil actualizado')
  } catch (err) {
    profileError.value = err instanceof ApiError ? err.message : 'Error inesperado'
  } finally {
    saving.value = false
  }
}

async function revoke(session: Session): Promise<void> {
  try {
    const res = await usersApi.revokeSession(session.id)
    if (res.isCurrent) {
      toast.success('Sesión actual revocada. Volvé a iniciar sesión.')
      await auth.logout()
      await router.push({ name: 'login' })
      return
    }
    toast.success('Sesión revocada')
    await loadSessions()
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'No se pudo revocar la sesión')
  }
}

async function changePassword(): Promise<void> {
  passwordError.value = ''
  if (password.next.length < 12) {
    passwordError.value = 'La nueva contraseña debe tener al menos 12 caracteres'
    return
  }
  if (password.next !== password.confirm) {
    passwordError.value = 'Las contraseñas nuevas no coinciden'
    return
  }
  saving.value = true
  try {
    await usersApi.changePassword(password.current, password.next)
    toast.success('Contraseña actualizada. Iniciá sesión nuevamente.')
    await auth.logout()
    await router.push({ name: 'login' })
  } catch (err) {
    passwordError.value = err instanceof ApiError ? err.message : 'Error inesperado'
  } finally {
    saving.value = false
  }
}

onMounted(loadSessions)
</script>

<template>
  <div class="topbar">
    <div>
      <h1 class="page-title">Mi perfil</h1>
      <p class="page-sub">{{ auth.user?.email }}</p>
    </div>
  </div>

  <div class="grid grid-2">
    <div class="card">
      <div class="card-head"><h2>Datos personales</h2></div>
      <form @submit.prevent="saveProfile">
        <div class="field-row">
          <div class="field">
            <label for="pfirst">Nombre</label>
            <input id="pfirst" v-model="profile.firstName" class="input" autocomplete="given-name" />
          </div>
          <div class="field">
            <label for="plast">Apellido</label>
            <input id="plast" v-model="profile.lastName" class="input" autocomplete="family-name" />
          </div>
        </div>
        <div class="field">
          <label>Roles</label>
          <div class="flex gap-8">
            <span v-for="r in auth.user?.roles ?? []" :key="r" class="badge badge-gold">{{ r }}</span>
          </div>
        </div>
        <p v-if="profileError" class="form-error">{{ profileError }}</p>
        <button class="btn btn-primary" type="submit" :disabled="saving">
          <span v-if="saving" class="spinner" /> Guardar cambios
        </button>
      </form>
    </div>

    <div class="card">
      <div class="card-head"><h2>Cambiar contraseña</h2></div>
      <form @submit.prevent="changePassword">
        <div class="field">
          <label for="cpass">Contraseña actual</label>
          <input id="cpass" v-model="password.current" class="input" type="password" autocomplete="current-password" />
        </div>
        <div class="field">
          <label for="npass">Nueva contraseña</label>
          <input id="npass" v-model="password.next" class="input" type="password" autocomplete="new-password" />
        </div>
        <div class="field">
          <label for="cfpass">Confirmar nueva</label>
          <input id="cfpass" v-model="password.confirm" class="input" type="password" autocomplete="new-password" />
        </div>
        <p v-if="passwordError" class="form-error">{{ passwordError }}</p>
        <button class="btn" type="submit" :disabled="saving">
          <span v-if="saving" class="spinner" /> Cambiar contraseña
        </button>
        <p class="hint mt-8">Al cambiarla se cierran todas tus sesiones, incluida la actual.</p>
      </form>
    </div>
  </div>

  <div class="card mt-16">
    <div class="card-head"><h2>Sesiones activas</h2></div>
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Dispositivo</th>
            <th>IP</th>
            <th>Última actividad</th>
            <th>Expira</th>
            <th class="right">Acción</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in sessions" :key="s.id">
            <td>
              <span v-if="s.isCurrent" class="badge badge-gold">Actual</span>
              <span v-else class="muted ellipsis" style="max-width: 260px">{{ s.userAgent ?? 'Desconocido' }}</span>
            </td>
            <td class="mono muted">{{ s.ipAddress ?? '—' }}</td>
            <td class="muted">{{ s.lastUsedAt ? formatDate(s.lastUsedAt) : '—' }}</td>
            <td class="muted">{{ formatDate(s.expiresAt) }}</td>
            <td class="right">
              <button v-if="!s.isCurrent" class="btn btn-sm btn-danger" type="button" @click="revoke(s)">
                Revocar
              </button>
            </td>
          </tr>
        </tbody>
      </table>
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