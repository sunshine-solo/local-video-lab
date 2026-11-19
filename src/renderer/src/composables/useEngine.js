import { computed, reactive } from 'vue'

export const engineState = reactive({
  loading: false,
  loaded: false,
  info: null,
  error: '',
})

let pending = null

export async function loadEngineInfo(force = false) {
  if (pending && !force) return pending
  engineState.loading = true
  pending = window.api.getEngineInfo(force)
    .then((result) => {
      if (result?.ok) {
        engineState.info = result.info
        engineState.error = ''
      } else {
        engineState.error = result?.error || '引擎检测失败'
      }
      return result
    })
    .catch((error) => {
      engineState.error = error?.message || '引擎检测失败'
      return { ok: false, error: engineState.error }
    })
    .finally(() => {
      engineState.loading = false
      engineState.loaded = true
      pending = null
    })
  return pending
}

export const engineReady = computed(() => Boolean(engineState.info?.ffmpegVersion))

export const engineStatusText = computed(() => {
  if (engineState.loading && !engineState.loaded) return '正在检测引擎'
  if (engineState.error) return '引擎不可用'
  if (!engineState.info?.ffmpegVersion) return '正在检测引擎'
  return `FFmpeg ${engineState.info.ffmpegVersion} 就绪`
})

export const encoderSummary = computed(() => {
  const info = engineState.info
  if (!info) return '正在检测'
  if (info.ffmpegVersion && info.hardwareEncoder) return info.hardwareEncoderLabel || info.hardwareEncoder
  if (info.ffmpegVersion) return 'libx264 软件编码'
  return '不可用'
})

export function useEngine() {
  return { engine: engineState, loadEngineInfo, engineReady, engineStatusText, encoderSummary }
}
