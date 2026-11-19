'use strict'

/*
 * Electron 端到端检查：在真实的 Electron + 生产构建中验证
 *   - preload 白名单 API 是否可用
 *   - 引擎检测 / ffprobe 读取是否正常
 *   - media:// 自定义协议能否被 <video> 加载、跳跃（Range）
 *   - canvas 能否读取视频帧（CORS 头是否生效，去水印框选依赖这个）
 *   - 生产构建的 CSP 是否允许本地脚本加载
 *
 * 运行：npm run test:e2e
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { app, BrowserWindow, ipcMain, session } = require('electron')

const { registerMediaScheme, registerMediaProtocol } = require('../src/main/mediaProtocol')
const { getEngineInfo } = require('../src/main/engineInfo')
const { probeMedia } = require('../src/main/ffmpeg/probe')
const { resolveBinaries } = require('../src/main/ffmpeg/binaries')
const { DEFAULTS } = require('../src/main/settings')

registerMediaScheme()

const ffmpegPath = require('ffmpeg-static')
const ffprobePath = require('@ffprobe-installer/ffprobe').path
const settings = { ...DEFAULTS, ffmpegPath, ffprobePath }

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-video-lab-e2e-'))
const samplePath = path.join(workDir, 'sample.mp4')

function makeSample() {
  const result = spawnSync(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=1.2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=1.2',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-shortest', samplePath,
  ], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr)
}

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
      const binaries = resolveBinaries(settings)
      return { ok: true, info: await probeMedia(binaries.ffprobe, filePath) }
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

async function waitForUi(win) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const ready = await win.webContents.executeJavaScript(
      'Boolean(document.querySelector(".nav-item") && document.querySelector(".brand"))',
    )
    if (ready) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('渲染界面未在 10 秒内加载完成')
}

async function main() {
  makeSample()
  await app.whenReady()
  registerMediaProtocol()
  registerIpc()
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))

  const win = new BrowserWindow({
    width: 1320,
    height: 900,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../src/preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const consoleErrors = []
  win.webContents.on('console-message', (details) => {
    if (details?.level === 'error' || details?.level === 3) {
      consoleErrors.push(details.message)
    }
  })
  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    consoleErrors.push(`preload ${preloadPath}: ${error.message}`)
  })

  await win.loadFile(path.join(__dirname, '../out/renderer/index.html'))
  await waitForUi(win)

  const result = await win.webContents.executeJavaScript(`(async () => {
    const engine = await window.api.getEngineInfo(true)
    const probe = await window.api.probe(${JSON.stringify(samplePath)})
    const url = window.api.toMediaUrl(${JSON.stringify(samplePath)})
    const video = document.createElement('video')
    video.muted = true
    video.crossOrigin = 'anonymous'
    video.preload = 'auto'
    video.src = url
    await new Promise((resolve, reject) => {
      video.addEventListener('loadeddata', resolve, { once: true })
      video.addEventListener('error', () => reject(new Error('video load failed')), { once: true })
      setTimeout(() => reject(new Error('video load timeout')), 8000)
    })
    video.currentTime = 0.5
    await new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }))
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 1
    canvas.height = video.videoHeight || 1
    const context = canvas.getContext('2d')
    context.drawImage(video, 0, 0)
    const pixel = Array.from(context.getImageData(0, 0, 1, 1).data)
    return {
      apiAvailable: typeof window.api?.getEngineInfo === 'function',
      navItems: document.querySelectorAll('.nav-item').length,
      title: document.title,
      engineOk: engine.ok && Boolean(engine.info?.ffmpegVersion),
      ffmpegVersion: engine.info?.ffmpegVersion,
      hardwareEncoder: engine.info?.hardwareEncoder || null,
      probeOk: probe.ok,
      probeSize: probe.info ? [probe.info.video.width, probe.info.video.height] : null,
      videoDuration: Number(video.duration.toFixed(2)),
      seekTime: Number(video.currentTime.toFixed(2)),
      canvasPixel: pixel,
      canvasTainted: false,
    }
  })()`, true)

  // 访问画布像素若被跨域污染会抛 SecurityError，上面的 Promise 会直接 reject。

  const checks = [
    [result.apiAvailable, 'preload API 不可用'],
    [result.navItems >= 4, '侧边栏导航未渲染'],
    [result.engineOk, 'FFmpeg 引擎检测失败'],
    [result.probeOk, 'ffprobe 读取失败'],
    [result.probeSize?.[0] === 320, '读取到的分辨率不正确'],
    [result.videoDuration > 1, 'video 元素无法播放 media:// 视频'],
    [result.seekTime > 0.4, 'media:// 协议 Range/seek 失败'],
    [result.canvasPixel?.[3] > 0, 'canvas 无法读取视频帧（可能被 CORS 污染）'],
  ]
  const failures = checks.filter(([ok]) => !ok)
  console.log(JSON.stringify({ result, consoleErrors }, null, 2))
  if (failures.length) {
    throw new Error(failures.map(([, message]) => message).join('；'))
  }
  if (consoleErrors.length) {
    console.warn(`渲染进程有 ${consoleErrors.length} 条 error 级日志（请人工确认）`)
  }
  console.log('\n✓ Electron 端到端检查通过')
}

main()
  .then(() => app.quit())
  .catch((error) => {
    console.error(`\n✗ Electron 端到端检查失败：${error.message}`)
    process.exitCode = 1
    app.quit()
  })
  .finally(() => {
    if (process.exitCode === 1) return
    fs.rmSync(workDir, { recursive: true, force: true })
  })
