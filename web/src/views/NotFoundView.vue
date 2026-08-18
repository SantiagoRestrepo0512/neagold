<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <div class="auth-shell">
    <div class="auth-card">
      <div class="logo-row">
        <img src="/favicon.svg" alt="" />
        <span>NEAGOLD</span>
      </div>
      <div class="full-center" style="min-height: 200px">
        <h1 class="auth-title">404 — Página no encontrada</h1>
        <p class="muted small">La página que buscás no existe o fue movida.</p>
        <button class="btn btn-primary" type="button" @click="router.push('/')">Volver al inicio</button>
      </div>
    </div>
  </div>
</template>