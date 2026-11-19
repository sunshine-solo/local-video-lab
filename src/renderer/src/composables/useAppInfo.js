import { reactive } from 'vue'

export const appInfo = reactive({
  loaded: false,
  name: '文艺文视频工坊',
  version: '',
  repoUrl: '',
  license: 'GPL-3.0-or-later',
  platform: '',
  arch: '',
  isPackaged: false,
  electron: '',
  chrome: '',
  node: '',
  userData: '',
})

let pending = null

export async function loadAppInfo() {
  if (pending) return pending
  pending = window.api.getAppInfo()
    .then((result) => {
      Object.assign(appInfo, result || {}, { loaded: true })
      return appInfo
    })
    .catch(() => {
      appInfo.loaded = true
      return appInfo
    })
    .finally(() => { pending = null })
  return pending
}

export function useAppInfo() {
  return appInfo
}
