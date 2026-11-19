import { computed, ref } from 'vue'

const STORAGE_KEY = 'local-video-lab.theme'
const mode = ref('system')
const resolved = ref('light')
let mediaQuery = null

function applyTheme(theme) {
  resolved.value = theme
  document.documentElement.dataset.theme = theme
  try {
    window.api?.setTheme?.(theme)
  } catch {
    // 主进程不可用时仅影响原生标题栏配色。
  }
}

function resolveCurrent() {
  const systemTheme = mediaQuery?.matches ? 'dark' : 'light'
  applyTheme(mode.value === 'system' ? systemTheme : mode.value)
}

export function initTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (['system', 'light', 'dark'].includes(stored)) mode.value = stored
  } catch {
    // localStorage 不可用时使用跟随系统。
  }
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  mediaQuery.addEventListener('change', resolveCurrent)
  resolveCurrent()
}

export function useTheme() {
  const setMode = (value) => {
    if (!['system', 'light', 'dark'].includes(value)) return
    mode.value = value
    try {
      localStorage.setItem(STORAGE_KEY, value)
    } catch {
      // 忽略存储失败。
    }
    resolveCurrent()
  }

  return {
    mode,
    resolved: computed(() => resolved.value),
    setMode,
  }
}
