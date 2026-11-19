<script setup>
import { CircleCheck, CircleAlert, Info, TriangleAlert, X } from '@lucide/vue'
import { toasts, dismissToast } from '@/composables/useToast'

const icons = {
  success: CircleCheck,
  error: CircleAlert,
  warning: TriangleAlert,
  info: Info,
}
</script>

<template>
  <Teleport to="body">
    <div class="toast-host" aria-live="polite">
      <TransitionGroup name="toast" tag="div" class="toast-stack">
        <div v-for="item in toasts" :key="item.id" class="toast" :class="item.type">
          <component :is="icons[item.type] || Info" :size="17" class="toast-icon" />
          <span class="toast-message">{{ item.message }}</span>
          <button class="toast-close" type="button" aria-label="关闭提示" @click="dismissToast(item.id)">
            <X :size="14" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-host {
  position: fixed;
  top: 20px;
  right: 22px;
  z-index: 1200;
  width: min(380px, calc(100vw - 44px));
  pointer-events: none;
}

.toast-stack {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 12px 12px 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  box-shadow: var(--shadow-pop);
  color: var(--text);
  font-size: 13px;
  line-height: 1.5;
  pointer-events: auto;
}

.toast-icon {
  flex: 0 0 auto;
  margin-top: 1px;
}

.toast.success .toast-icon { color: var(--success); }
.toast.error .toast-icon { color: var(--danger); }
.toast.warning .toast-icon { color: var(--warning); }
.toast.info .toast-icon { color: var(--accent); }

.toast-message {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.toast-close {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  margin-top: -1px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-3);
}

.toast-close:hover {
  background: var(--surface-3);
  color: var(--text);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(18px);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(18px);
}

.toast-move {
  transition: transform 0.2s ease;
}
</style>
