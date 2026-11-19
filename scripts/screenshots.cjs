'use strict'

/*
 * 使用 Electron 的生产构建自动截图，输出到 docs/screenshots。
 * 不需要屏幕录制权限：截图来自 webContents.capturePage()。
 *
 * 运行：npm run screenshots
 */

const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow, ipcMain, session } = require('electron')

const { registerMediaScheme, registerMediaProtocol } = require('../src/main/mediaProtocol')
const { getEngineInfo } = require('../src/main/engineInfo')
const { resolveBinaries } = require('../src/main/ffmpeg/binaries')
const { probeMedia } = require('../src/main/ffmpeg/probe')
const { DEFAULTS } = require('../src/main/settings')

registerMediaScheme()

const settings = {
  ...DEFAULTS,
  ffmpegPath: require('ffmpeg-static'),
  ffprobePath: require('@ffprobe-installer/ffprobe').path,
}
const outputDir = path.join(__dirname, '..', 'docs', 'screenshots')
const rendererFile = path.join(__dirname, '..', 'out', 'renderer', 'index.html')

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    name: '文艺文视频工坊',
    version: require('../package.json').version,
    repoUrl: 'https://github.com/sunshine-solo/local-video-lab',
    license: 'GPL-3.0-or-later',
    platform: process.platform,
    arch: process.arch,
    isPackaged: false,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    userData: app.getPath('userData'),
  }))
  ipcMain.handle('settings:get', () => settings)
  ipcMain.handle('settings:save', () => settings)
  ipcMain.handle('theme:set', () => ({ ok: true }))
  ipcMain.handle('engine:info', async (_event, payload = {}) => ({
    ok: true,
    info: await getEngineInfo(settings, { force: Boolean(payload.force) }),
  }))
  ipcMain.handle('media:probe', async (_event, filePath) => {
    try {
      return { ok: true, info: await probeMedia(resolveBinaries(settings).ffprobe, filePath) }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })
  ipcMain.handle('dialog:select-videos', () => ({ ok: false, paths: [] }))
  ipcMain.handle('dialog:select-output', () => ({ ok: false, canceled: true }))
  ipcMain.handle('dialog:select-binary', () => ({ ok: false }))
  ipcMain.handle('job:cancel', () => ({ ok: true }))
  ipcMain.handle('app:clear-temp', () => ({ ok: true, removed: 0 }))
  ipcMain.handle('shell:reveal', () => ({ ok: true }))
  ipcMain.handle('shell:open', () => ({ ok: true }))
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForUi(win) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const ready = await win.webContents.executeJavaScript(
      'Boolean(document.querySelector(".nav-item") && document.querySelector(".brand"))',
    )
    if (ready) return
    await wait(250)
  }
  throw new Error('界面未在 10 秒内加载完成')
}

async function capture(win, name) {
  const image = await win.webContents.capturePage()
  const target = path.join(outputDir, `${name}.png`)
  fs.writeFileSync(target, image.toPNG())
  console.log(`  ✓ ${path.relative(process.cwd(), target)} (${image.getSize().width}x${image.getSize().height})`)
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true })
  await app.whenReady()
  registerMediaProtocol()
  registerIpc()
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))

  const win = new BrowserWindow({
    width: 1320,
    height: 900,
    show: false,
    backgroundColor: '#f2f5f4',
    webPreferences: {
      preload: path.join(__dirname, '../src/preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })

  await win.loadFile(rendererFile)
  await waitForUi(win)
  await wait(600)

  console.log('生成截图…')
  await capture(win, '01-home')

  await win.webContents.executeJavaScript("location.hash = '#/joiner'")
  await wait(700)
  await capture(win, '02-joiner')

  await win.webContents.executeJavaScript("location.hash = '#/blur'")
  await wait(700)
  await capture(win, '03-blur')

  await win.webContents.executeJavaScript("location.hash = '#/settings'")
  await wait(1200)
  await capture(win, '04-settings')

  await win.webContents.executeJavaScript("location.hash = '#/about'")
  await wait(700)
  await capture(win, '05-about')

  await win.webContents.executeJavaScript("location.hash = '#/'")
  await wait(600)
  await win.webContents.executeJavaScript("document.documentElement.dataset.theme = 'dark'")
  await wait(350)
  await capture(win, '06-home-dark')

  console.log('截图完成。')
}

main()
  .then(() => app.quit())
  .catch((error) => {
    console.error(`截图失败：${error.message}`)
    app.exit(1)
  })
