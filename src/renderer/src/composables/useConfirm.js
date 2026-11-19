import { reactive } from 'vue'

export const confirmState = reactive({
  open: false,
  title: '请确认',
  message: '',
  confirmText: '确定',
  cancelText: '取消',
  danger: false,
  _resolve: null,
})

export function confirm(options = {}) {
  return new Promise((resolve) => {
    confirmState.open = true
    confirmState.title = options.title || '请确认'
    confirmState.message = options.message || ''
    confirmState.confirmText = options.confirmText || '确定'
    confirmState.cancelText = options.cancelText || '取消'
    confirmState.danger = Boolean(options.danger)
    confirmState._resolve = resolve
  })
}

export function settleConfirm(value) {
  const resolve = confirmState._resolve
  confirmState._resolve = null
  confirmState.open = false
  if (resolve) resolve(value)
}
