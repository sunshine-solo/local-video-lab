<script setup>
import { computed } from 'vue'

const props = defineProps({
  value: { type: Number, default: 0 },
  tone: { type: String, default: 'accent' },
})

const width = computed(() => `${Math.max(0, Math.min(100, Number(props.value) || 0))}%`)
</script>

<template>
  <div class="progress-track" role="progressbar" :aria-valuenow="Math.round(value)" aria-valuemin="0" aria-valuemax="100">
    <div class="progress-fill" :class="tone" :style="{ width }"></div>
  </div>
</template>

<style scoped>
.progress-fill.danger {
  background: linear-gradient(90deg, var(--danger), #e26b5f);
}
</style>
