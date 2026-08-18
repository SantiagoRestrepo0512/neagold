import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean
    permission?: string | string[]
    title?: string
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/auth/LoginView.vue'),
      meta: { public: true, title: 'Iniciar sesión' }
    },
    {
      path: '/register',
      name: 'register',
      component: () => import('@/views/auth/RegisterView.vue'),
      meta: { public: true, title: 'Crear cuenta' }
    },
    {
      path: '/forgot-password',
      name: 'forgot-password',
      component: () => import('@/views/auth/ForgotPasswordView.vue'),
      meta: { public: true, title: 'Recuperar contraseña' }
    },
    {
      path: '/reset-password/:token',
      name: 'reset-password',
      component: () => import('@/views/auth/ResetPasswordView.vue'),
      meta: { public: true, title: 'Nueva contraseña' }
    },
    {
      path: '/verify-email/:token',
      name: 'verify-email',
      component: () => import('@/views/auth/VerifyEmailView.vue'),
      meta: { public: true, title: 'Verificar correo' }
    },
    {
      path: '/verify/:token',
      name: 'verify-public',
      component: () => import('@/views/verify/VerifyPublicView.vue'),
      meta: { public: true, title: 'Verificación de pieza' }
    },
    {
      path: '/',
      component: () => import('@/components/AppLayout.vue'),
      children: [
        {
          path: '',
          name: 'dashboard',
          component: () => import('@/views/DashboardView.vue'),
          meta: { title: 'Resumen' }
        },
        {
          path: 'products',
          name: 'products',
          component: () => import('@/views/ProductsView.vue'),
          meta: { permission: 'products:read', title: 'Catálogo' }
        },
        {
          path: 'pieces',
          name: 'pieces',
          component: () => import('@/views/PiecesView.vue'),
          meta: { permission: ['pieces:list', 'pieces:read_own'], title: 'Piezas' }
        },
        {
          path: 'pieces/:id',
          name: 'piece-detail',
          component: () => import('@/views/PieceDetailView.vue'),
          meta: { permission: ['pieces:read', 'pieces:read_own'], title: 'Pieza' }
        },
        {
          path: 'sales',
          name: 'sales',
          component: () => import('@/views/SalesView.vue'),
          meta: { permission: ['sales:read', 'sales:create'], title: 'Ventas' }
        },
        {
          path: 'claims',
          name: 'claims',
          component: () => import('@/views/ClaimsView.vue'),
          meta: { permission: ['claims:read', 'claims:redeem'], title: 'Garantías' }
        },
        {
          path: 'transfers',
          name: 'transfers',
          component: () => import('@/views/TransfersView.vue'),
          meta: { permission: ['transfers:request', 'transfers:accept', 'transfers:reject', 'transfers:manage'], title: 'Transferencias' }
        },
        {
          path: 'incidents',
          name: 'incidents',
          component: () => import('@/views/IncidentsView.vue'),
          meta: { permission: ['incidents:create', 'incidents:read', 'incidents:read_own'], title: 'Incidentes' }
        },
        {
          path: 'certificates',
          name: 'certificates',
          component: () => import('@/views/CertificatesView.vue'),
          meta: { permission: ['certificates:read', 'certificates:read_own'], title: 'Certificados' }
        },
        {
          path: 'services',
          name: 'services',
          component: () => import('@/views/ServicesView.vue'),
          meta: { permission: ['services:read', 'services:request'], title: 'Servicios' }
        },
        {
          path: 'notifications',
          name: 'notifications',
          component: () => import('@/views/NotificationsView.vue'),
          meta: { permission: 'notifications:read_own', title: 'Notificaciones' }
        },
        {
          path: 'webhooks',
          name: 'webhooks',
          component: () => import('@/views/WebhooksView.vue'),
          meta: { permission: ['webhooks:manage_own', 'webhooks:manage'], title: 'Webhooks' }
        },
        {
          path: 'profile',
          name: 'profile',
          component: () => import('@/views/ProfileView.vue'),
          meta: { title: 'Mi perfil' }
        }
      ]
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
      meta: { public: true, title: 'No encontrado' }
    }
  ]
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()

  if (to.meta.public === true) {
    if ((to.name === 'login' || to.name === 'register') && auth.authenticated) {
      return { name: 'dashboard' }
    }
    return true
  }

  if (!auth.authenticated) {
    try {
      const ok = await auth.bootstrap()
      if (!ok) {
        return { name: 'login', query: { redirect: to.fullPath } }
      }
    } catch {
      return { name: 'login', query: { redirect: to.fullPath } }
    }
  }

  if (to.meta.permission && !auth.hasPerm(to.meta.permission)) {
    return { name: 'dashboard' }
  }

  return true
})

router.afterEach((to) => {
  const base = to.meta.title
  document.title = base ? `${base} · NEAGOLD` : 'NEAGOLD'
})

export default router