<script setup>
import { nextTick, ref, watch } from 'vue'
import { TriangleAlert, CircleHelp } from '@lucide/vue'
import { confirmState, settleConfirm } from '@/composables/useConfirm'

const confirmButton = ref(null)

const onKeydown = (event) => {
  if (!confirmState.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    settleConfirm(false)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    settleConfirm(true)
  }
}

watch(() => confirmState.open, async (open) => {
  if (open) {
    window.addEventListener('keydown', onKeydown)
    await nextTick()
    confirmButton.value?.focus()
  } else {
    window.removeEventListener('keydown', onKeydown)
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="confirmState.open" class="modal-overlay" @mousedown.self="settleConfirm(false)">
        <div class="modal-card" role="dialog" aria-modal="true">
          <div class="modal-icon" :class="{ danger: confirmState.danger }">
            <TriangleAlert v-if="confirmState.danger" :size="20" />
            <CircleHelp v-else :size="20" />
          </div>
          <h3>{{ confirmState.title }}</h3>
          <p>{{ confirmState.message }}</p>
          <div class="modal-actions">
            <button class="btn btn-secondary" type="button" @click="settleConfirm(false)">
              {{ confirmState.cancelText }}
            </button>
            <button
              ref="confirmButton"
              class="btn"
              :class="confirmState.danger ? 'btn-danger' : 'btn-primary'"
              type="button"
              @click="settleConfirm(true)"
            >
              {{ confirmState.confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(6, 17, 15, 0.48);
  backdrop-filter: blur(3px);
}

.modal-card {
  width: min(400px, 100%);
  padding: 22px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
  box-shadow: var(--shadow-pop);
}

.modal-icon {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  margin-bottom: 14px;
  border-radius: 11px;
  background: var(--accent-soft);
  color: var(--accent-text);
}

.modal-icon.danger {
  background: var(--danger-soft);
  color: var(--danger);
}

.modal-card h3 {
  font-size: 16px;
  font-weight: 700;
}

.modal-card p {
  margin-top: 7px;
  color: var(--text-2);
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-line;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
  margin-top: 20px;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.16s ease;
}

.modal-enter-active .modal-card,
.modal-leave-active .modal-card {
  transition: transform 0.16s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-card,
.modal-leave-to .modal-card {
  transform: scale(0.97) translateY(4px);
}
</style>
