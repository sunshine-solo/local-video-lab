import { computed, reactive } from 'vue'

export const settingsState = reactive({
  loaded: false,
  ffmpegPath: '',
  ffprobePath: '',
  hardwareAcceleration: true,
  lastOutputDir: '',
})

let pending = null

export async function loadSettings() {
  if (pending) return pending
  pending = window.api.getSettings()
    .then((result) => {
      Object.assign(settingsState, result || {}, { loaded: true })
      return settingsState
    })
    .catch(() => {
      settingsState.loaded = true
      return settingsState
    })
    .finally(() => { pending = null })
  return pending
}

export async function updateSettings(patch) {
  const result = await window.api.saveSettings(patch)
  Object.assign(settingsState, result || {}, { loaded: true })
  return result
}

export const hardwareEnabled = computed(() => settingsState.hardwareAcceleration !== false)

export function useSettings() {
  return { settings: settingsState, loadSettings, updateSettings, hardwareEnabled }
}
