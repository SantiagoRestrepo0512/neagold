<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  total: number
  limit: number
  offset: number
}>()

const emit = defineEmits<{ page: [offset: number] }>()

const pages = computed(() => Math.max(1, Math.ceil(props.total / props.limit)))
const current = computed(() => Math.floor(props.offset / props.limit) + 1)

function go(page: number): void {
  if (page < 1 || page > pages.value || page === current.value) return
  emit('page', (page - 1) * props.limit)
}
</script>

<template>
  <div v-if="total > limit" class="pagination">
    <button class="btn btn-sm" type="button" :disabled="current <= 1" @click="go(current - 1)">
      ←
    </button>
    <span class="page-info">
      Página {{ current }} de {{ pages }} · {{ total }} registros
    </span>
    <button class="btn btn-sm" type="button" :disabled="current >= pages" @click="go(current + 1)">
      →
    </button>
  </div>
</template>

<style scoped>
.pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 14px;
}
.page-info {
  color: var(--text-muted);
  font-size: 12.5px;
}
</style>