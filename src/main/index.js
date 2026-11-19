'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, session, nativeTheme } = require('electron')

const { registerMediaScheme, registerMediaProtocol } = require('./mediaProtocol')
const settingsStore = require('./settings')
const jobs = require('./jobs')
const { getEngineInfo, testBinaries } = require('./engineInfo')
const { probeMedia } = require('./ffmpeg/probe')
const { resolveBinaries, ensureExecutable } = require('./ffmpeg/binaries')
const { cleanupStaleTempDirs, clearJobTempDirs } = require('./tempCleanup')
const { checkForUpdates } = require('./updateChecker')
const { APP_DISPLAY_NAME, REPO_URL } = require('./constants')

const VIDEO_EXTENSIONS = [
  'mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'flv', 'wmv',
  'mpg', 'mpeg', 'ts', 'm2ts', '3gp', 'ogv', 'ogg',
]

registerMediaScheme()

let mainWindow = null

const isDev = !app.isPackaged

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    title: APP_DISPLAY_NAME,
    backgroundColor: '#f3f6f5',
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => { mainWindow = null })

  // 兜底：即使 ready-to-show 未触发（例如渲染层加载失败），也让窗口可见以便排查。
  const showTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) mainWindow.show()
  }, 4000)
  showTimer.unref?.()
  mainWindow.on('closed', () => clearTimeout(showTimer))

  if (isDev) {
    // 开发模式下把渲染进程日志带到终端，便于排查 CSP / HMR / preload 问题。
    mainWindow.webContents.on('console-message', (details) => {
      console.log(`[renderer:${details.level || 'log'}] ${details.message}`)
    })
    mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
      console.error(`[preload-error] ${preloadPath}: ${error.message}`)
    })
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault()
  })

  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`[renderer] 页面加载失败 (${code} ${description})：${url}`)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function openUserDataDirectory() {
  shell.openPath(app.getPath('userData'))
}

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac
      ? [{
          label: APP_DISPLAY_NAME,
          submenu: [
            { role: 'about', label: `关于 ${APP_DISPLAY_NAME}` },
            { type: 'separator' },
            { label: '打开数据目录', click: openUserDataDirectory },
            { type: 'separator' },
            { role: 'hide', label: '隐藏' },
            { role: 'hideOthers', label: '隐藏其他' },
            { role: 'unhide', label: '全部显示' },
            { type: 'separator' },
            { role: 'quit', label: '退出' },
          ],
        }]
      : []),
    {
      label: '文件',
      submenu: [
        { label: '打开数据目录', click: openUserDataDirectory },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        ...(isDev ? [{ role: 'toggleDevTools', label: '开发者工具' }] : []),
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '项目主页', click: () => shell.openExternal(REPO_URL) },
        { label: 'FFmpeg 官网', click: () => shell.openExternal('https://ffmpeg.org/') },
        { type: 'separator' },
        {
          label: `关于 ${APP_DISPLAY_NAME}`,
          click: () => mainWindow?.webContents.send('app:show-about'),
        },
      ],
    },
  ]
  return Menu.buildFromTemplate(template)
}

function safeOutputName(name) {
  const cleaned = String(name || '输出视频.mp4')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim()
    .slice(0, 160)
  if (!cleaned) return '输出视频.mp4'
  return /\.mp4$/i.test(cleaned) ? cleaned : `${cleaned}.mp4`
}

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    name: APP_DISPLAY_NAME,
    version: app.getVersion(),
    repoUrl: REPO_URL,
    license: 'GPL-3.0-or-later',
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    userData: app.getPath('userData'),
  }))

  ipcMain.handle('settings:get', () => settingsStore.getSettings())
  ipcMain.handle('settings:save', (_event, patch) => settingsStore.saveSettings(patch))

  ipcMain.handle('theme:set', (_event, theme) => {
    if (!['system', 'light', 'dark'].includes(theme)) return { ok: false }
    nativeTheme.themeSource = theme
    return { ok: true }
  })

  ipcMain.handle('dialog:select-videos', async () => {
    if (!mainWindow) return { ok: false, paths: [] }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择视频文件',
      properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
      filters: [
        { name: '视频文件', extensions: VIDEO_EXTENSIONS },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    return { ok: !result.canceled, paths: result.canceled ? [] : result.filePaths }
  })

  ipcMain.handle('dialog:select-output', async (_event, payload = {}) => {
    if (!mainWindow) return { ok: false, canceled: true }
    const settings = settingsStore.getSettings()
    let defaultDirectory = settings.lastOutputDir
    try {
      if (!defaultDirectory || !fs.statSync(defaultDirectory).isDirectory()) {
        defaultDirectory = app.getPath('videos')
      }
    } catch {
      defaultDirectory = app.getPath('videos')
    }

    const fileName = safeOutputName(payload.fileName)
    const result = await dialog.showSaveDialog(mainWindow, {
      title: payload.title || '选择输出位置',
      defaultPath: path.join(defaultDirectory, fileName),
      filters: [{ name: 'MP4 视频', extensions: ['mp4'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }

    let outputPath = result.filePath
    if (!/\.mp4$/i.test(outputPath)) outputPath += '.mp4'
    settingsStore.rememberOutputDirectory(outputPath)
    return { ok: true, path: outputPath }
  })

  ipcMain.handle('dialog:select-binary', async (_event, kind = 'ffmpeg') => {
    if (!mainWindow) return { ok: false }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: kind === 'ffprobe' ? '选择 FFprobe 可执行文件' : '选择 FFmpeg 可执行文件',
      properties: ['openFile', 'dontAddToRecent'],
      filters: [{ name: '所有文件', extensions: ['*'] }],
    })
    if (result.canceled || !result.filePaths[0]) return { ok: false }
    return { ok: true, path: result.filePaths[0] }
  })

  ipcMain.handle('media:probe', async (_event, filePath) => {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
      return { ok: false, error: '无效的视频路径' }
    }
    try {
      const binaries = resolveBinaries(settingsStore.getSettings())
      ensureExecutable(binaries.ffprobe)
      const info = await probeMedia(binaries.ffprobe, filePath)
      return { ok: true, info }
    } catch (error) {
      return { ok: false, error: error.message || '无法读取视频信息' }
    }
  })

  ipcMain.handle('job:join', async (event, payload) => (
    jobs.runJob('join', payload, event.sender, settingsStore.getSettings)
  ))

  ipcMain.handle('job:blur', async (event, payload) => (
    jobs.runJob('blur', payload, event.sender, settingsStore.getSettings)
  ))

  ipcMain.handle('job:cancel', (_event, jobId) => jobs.cancelJob(jobId))

  ipcMain.handle('engine:info', async (_event, payload = {}) => {
    try {
      return {
        ok: true,
        info: await getEngineInfo(settingsStore.getSettings(), { force: Boolean(payload?.force) }),
      }
    } catch (error) {
      return { ok: false, error: error.message || '引擎检测失败' }
    }
  })

  ipcMain.handle('engine:test', async (_event, payload = {}) => {
    try {
      return await testBinaries(payload || {})
    } catch (error) {
      return { ok: false, error: error.message || '测试失败' }
    }
  })

  ipcMain.handle('update:check', async () => {
    try {
      return await checkForUpdates({
        currentVersion: app.getVersion(),
        repoUrl: REPO_URL,
      })
    } catch (error) {
      return { ok: false, currentVersion: app.getVersion(), error: error.message || '检查更新失败' }
    }
  })

  ipcMain.handle('app:clear-temp', async () => {
    if (jobs.isJobActive()) {
      return { ok: false, error: '请先等待当前任务结束或取消任务' }
    }
    const removed = await clearJobTempDirs()
    return { ok: true, removed }
  })

  ipcMain.handle('shell:reveal', (_event, filePath) => {
    if (typeof filePath !== 'string' || !filePath) return { ok: false }
    shell.showItemInFolder(filePath)
    return { ok: true }
  })

  ipcMain.handle('shell:open', async (_event, filePath) => {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
      return { ok: false, error: '无效路径' }
    }
    const error = await shell.openPath(filePath)
    return error ? { ok: false, error } : { ok: true }
  })
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.setAboutPanelOptions({
    applicationName: APP_DISPLAY_NAME,
    applicationVersion: app.getVersion(),
    version: `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
    copyright: 'GPL-3.0-or-later · 基于 FFmpeg',
    credits: '所有视频均在本机处理，不上传任何文件。',
  })
  app.setAppUserModelId('com.localvideolab.app')

  app.whenReady().then(async () => {
    registerMediaProtocol()

    // 无界面自检：用于打包后验证内置 FFmpeg / FFprobe 是否可用。
    // 用法：LocalVideoLab --self-test
    if (process.argv.includes('--self-test')) {
      try {
        const info = await getEngineInfo(settingsStore.getSettings(), { force: true })
        console.log(JSON.stringify({
          ok: !info.error,
          appName: app.getName(),
          userData: app.getPath('userData'),
          info,
        }, null, 2))
        if (info.error) app.exit(1)
        else app.exit(0)
      } catch (error) {
        console.log(JSON.stringify({ ok: false, error: error.message }, null, 2))
        app.exit(1)
      }
      return
    }

    registerIpc()
    Menu.setApplicationMenu(buildMenu())

    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false)
    })

    createWindow()
    cleanupStaleTempDirs().catch(() => {})

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => {
    jobs.cancelActiveJob()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
