<script setup>
import { ShieldCheck } from '@lucide/vue'

defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  badge: { type: String, default: '本地处理 · 不上传' },
})
</script>

<template>
  <header class="page-header">
    <div class="heading">
      <div class="title-row">
        <h1>{{ title }}</h1>
        <span v-if="badge" class="pill pill-accent">
          <ShieldCheck />
          {{ badge }}
        </span>
      </div>
      <p v-if="subtitle">{{ subtitle }}</p>
    </div>
    <div class="header-actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  padding: 2px 2px 0;
}

.heading {
  min-width: 0;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

h1 {
  font-size: 27px;
  font-weight: 750;
  letter-spacing: -0.025em;
  line-height: 1.2;
}

.heading p {
  max-width: 720px;
  margin-top: 7px;
  color: var(--text-2);
  font-size: 13.5px;
  line-height: 1.6;
}

.header-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
