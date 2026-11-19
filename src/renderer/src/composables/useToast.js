import { ref } from 'vue'

let nextId = 1
export const toasts = ref([])

function push(type, message, duration = 3600) {
  if (!message) return
  const id = nextId++
  toasts.value = [...toasts.value, { id, type, message }]
  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration)
  }
}

export function dismissToast(id) {
  toasts.value = toasts.value.filter((item) => item.id !== id)
}

export const toast = {
  success: (message, duration) => push('success', message, duration),
  error: (message, duration = 5600) => push('error', message, duration),
  warning: (message, duration = 4600) => push('warning', message, duration),
  info: (message, duration) => push('info', message, duration),
}
