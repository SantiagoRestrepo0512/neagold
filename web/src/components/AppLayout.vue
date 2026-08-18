<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { initials, fullName } from '@/utils/format'
import Ic from '@/components/Ic.vue'

interface NavItem {
  to: string
  label: string
  icon: string
  perm?: string | string[]
}

interface NavSection {
  label: string
  items: NavItem[]
}

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const sections = computed<NavSection[]>(() => [
  {
    label: 'General',
    items: [{ to: '/', label: 'Resumen', icon: 'dashboard' }]
  },
  {
    label: 'Operaciones',
    items: [
      { to: '/products', label: 'Catálogo', icon: 'box', perm: 'products:read' },
      { to: '/pieces', label: 'Piezas', icon: 'gem', perm: ['pieces:list', 'pieces:read_own'] },
      { to: '/sales', label: 'Ventas', icon: 'tag', perm: ['sales:read', 'sales:create'] },
      { to: '/claims', label: 'Garantías', icon: 'shield', perm: ['claims:read', 'claims:redeem'] },
      {
        to: '/transfers',
        label: 'Transferencias',
        icon: 'transfer',
        perm: ['transfers:request', 'transfers:accept', 'transfers:reject', 'transfers:manage']
      },
      {
        to: '/incidents',
        label: 'Incidentes',
        icon: 'alert',
        perm: ['incidents:create', 'incidents:read', 'incidents:read_own']
      },
      {
        to: '/certificates',
        label: 'Certificados',
        icon: 'document',
        perm: ['certificates:read', 'certificates:read_own']
      },
      {
        to: '/services',
        label: 'Servicios',
        icon: 'wrench',
        perm: ['services:read', 'services:request']
      }
    ]
  },
  {
    label: 'Cuenta',
    items: [
      { to: '/notifications', label: 'Notificaciones', icon: 'bell', perm: 'notifications:read_own' },
      { to: '/webhooks', label: 'Webhooks', icon: 'webhook', perm: ['webhooks:manage_own', 'webhooks:manage'] },
      { to: '/profile', label: 'Mi perfil', icon: 'user' }
    ]
  }
])

const visibleSections = computed(() =>
  sections.value
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.perm || auth.hasPerm(i.perm)) }))
    .filter((s) => s.items.length > 0)
)

async function logout(): Promise<void> {
  await auth.logout()
  router.push({ name: 'login' })
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="sidebar-brand">
        <img class="logo" src="/favicon.svg" alt="NEAGOLD" />
        <span>NEAGOLD</span>
      </div>
      <nav>
        <template v-for="section in visibleSections" :key="section.label">
          <div class="nav-section">{{ section.label }}</div>
          <router-link
            v-for="item in section.items"
            :key="item.to"
            :to="item.to"
            class="nav-link"
            :class="{ active: route.path === item.to || (item.to !== '/' && route.path.startsWith(item.to)) }"
          >
            <Ic :name="item.icon" class="ico" />
            <span>{{ item.label }}</span>
          </router-link>
        </template>
      </nav>
      <div class="sidebar-footer">
        <span class="avatar">{{ initials(auth.user?.firstName ?? '?', auth.user?.lastName ?? '?') }}</span>
        <div class="footer-name">
          <div class="ellipsis">{{ fullName(auth.user?.firstName ?? '', auth.user?.lastName ?? '') }}</div>
          <div class="footer-email ellipsis muted">{{ auth.user?.roles.join(' · ') }}</div>
        </div>
        <button class="btn btn-ghost btn-sm" type="button" title="Cerrar sesión" @click="logout">
          ⏻
        </button>
      </div>
    </aside>
    <main class="main">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: linear-gradient(180deg, var(--gold-light), var(--gold-dark));
  color: #1a1505;
  font-size: 11.5px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.footer-name {
  min-width: 0;
  flex: 1;
  line-height: 1.3;
}

.footer-email {
  font-size: 11px;
}

.nav-link.active {
  background: rgba(212, 175, 55, 0.12);
  color: var(--gold-light);
}
</style>