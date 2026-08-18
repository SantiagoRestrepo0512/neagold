<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ value: string }>()

const palette: Record<string, string> = {
  ACTIVE: 'gold',
  PENDING_VERIFICATION: 'amber',
  DISABLED: 'gray',
  LOCKED: 'red',
  IN_STOCK: 'gold',
  AVAILABLE: 'green',
  SOLD: 'blue',
  IN_SERVICE: 'amber',
  REPORTED_STOLEN: 'red',
  LOST: 'red',
  RETIRED: 'gray',
  PENDING: 'amber',
  USED: 'blue',
  EXPIRED: 'gray',
  REVOKED: 'red',
  REQUESTED: 'amber',
  IN_PROGRESS: 'blue',
  COMPLETED: 'green',
  ACCEPTED: 'green',
  REJECTED: 'red',
  CANCELLED: 'gray',
  UNDER_REVIEW: 'amber',
  RECOVERED: 'green',
  RESOLVED: 'blue',
  SUBMITTED: 'amber',
  VERIFIED: 'green',
  DELIVERING: 'amber',
  SUCCESS: 'green',
  FAILED: 'red',
  DELIVERY_FAILED: 'red',
  PENDING_CLAIM: 'gold',
  CLAIMED: 'green',
  SUSPENDED: 'red'
}

const kind = computed(() => palette[props.value] ?? 'gray')
</script>

<template>
  <span class="badge" :class="`badge-${kind}`">{{ value.replace(/_/g, ' ') }}</span>
</template>