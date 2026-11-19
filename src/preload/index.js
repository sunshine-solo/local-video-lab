'use strict'

const { contextBridge, ipcRenderer, webUtils } = require('electron')

/*
 * 渲染进程只通过这个白名单 API 与主进程通信。
 * sandbox + contextIsolation 开启，渲染进程无法直接访问 Node/文件系统。
 */

let nextListenerId = 1
const progressListeners = new Map()
const aboutListeners = new Map()

ipcRenderer.on('job:progress', (_event, payload) => {
  for (const callback of progressListeners.values()) {
    try {
      callback(payload)
    } catch (error) {
      console.error('job progress listener error:', error)
    }
  }
})

ipcRenderer.on('app:show-about', () => {
  for (const callback of aboutListeners.values()) {
    try {
      callback()
    } catch (error) {
      console.error('about listener error:', error)
    }
  }
})

const api = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },

  getPathForFile: (file) => webUtils.getPathForFile(file),
  toMediaUrl: (filePath) => `media://local/${encodeURIComponent(String(filePath))}`,

  selectVideos: () => ipcRenderer.invoke('dialog:select-videos'),
  selectOutput: (payload) => ipcRenderer.invoke('dialog:select-output', payload),
  selectBinary: (kind) => ipcRenderer.invoke('dialog:select-binary', kind),

  probe: (filePath) => ipcRenderer.invoke('media:probe', filePath),

  startJoin: (payload) => ipcRenderer.invoke('job:join', payload),
  startBlur: (payload) => ipcRenderer.invoke('job:blur', payload),
  cancelJob: (jobId) => ipcRenderer.invoke('job:cancel', jobId),
  onJobProgress: (callback) => {
    const id = nextListenerId++
    progressListeners.set(id, callback)
    return id
  },
  offJobProgress: (id) => {
    progressListeners.delete(id)
  },

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  getEngineInfo: (force = false) => ipcRenderer.invoke('engine:info', { force }),
  testBinaries: (paths) => ipcRenderer.invoke('engine:test', paths),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  clearTemp: () => ipcRenderer.invoke('app:clear-temp'),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),


  revealFile: (filePath) => ipcRenderer.invoke('shell:reveal', filePath),
  openPath: (filePath) => ipcRenderer.invoke('shell:open', filePath),

  onShowAbout: (callback) => {
    const id = nextListenerId++
    aboutListeners.set(id, callback)
    return id
  },
  offShowAbout: (id) => {
    aboutListeners.delete(id)
  },
}

contextBridge.exposeInMainWorld('api', api)
