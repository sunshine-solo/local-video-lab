'use strict'

/*
 * 真实 UI 流程测试：
 *   1. 打开去水印页 → 自动“选择”测试视频 → 在画面上拖拽框选 → 点击一键处理 → 校验输出
 *   2. 打开拼接页 → 连续添加两段相同视频 → 点击开始拼接 → 校验无损拼接输出
 * 同时保存两张带数据的界面截图。
 *
 * 运行：npm run test:ui
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
const { runJob, cancelJob } = require('../src/main/jobs')

registerMediaScheme()

const ffmpegPath = require('ffmpeg-static')
const ffprobePath = require('@ffprobe-installer/ffprobe').path
const settings = { ...DEFAULTS, ffmpegPath, ffprobePath }

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-video-lab-ui-'))
const samplePath = path.join(workDir, 'sample.mp4')
const blurOutput = path.join(workDir, 'blur-output.mp4')
const joinOutput = path.join(workDir, 'join-output.mp4')
const outputPaths = [blurOutput, joinOutput]
const screenshotsDir = path.join(__dirname, '..', 'docs', 'screenshots')
const rendererFile = path.join(__dirname, '..', 'out', 'renderer', 'index.html')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function makeSample() {
  const result = spawnSync(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=3',
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
  ipcMain.handle('settings:save', (_event, patch) => Object.assign(settings, patch))
  ipcMain.handle('theme:set', () => ({ ok: true }))
  ipcMain.handle('engine:info', async (_event, payload = {}) => ({
    ok: true,
    info: await getEngineInfo(settings, { force: Boolean(payload.force) }),
  }))
  ipcMain.handle('engine:test', () => ({ ok: true }))
  ipcMain.handle('media:probe', async (_event, filePath) => {
    try {
      return { ok: true, info: await probeMedia(resolveBinaries(settings).ffprobe, filePath) }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  })
  ipcMain.handle('dialog:select-videos', () => ({ ok: true, paths: [samplePath] }))
  ipcMain.handle('dialog:select-output', () => {
    const filePath = outputPaths.shift()
    return filePath
      ? { ok: true, path: filePath }
      : { ok: false, canceled: true }
  })
  ipcMain.handle('dialog:select-binary', () => ({ ok: false }))
  ipcMain.handle('job:blur', (event, payload) => runJob('blur', payload, event.sender, () => settings))
  ipcMain.handle('job:join', (event, payload) => runJob('join', payload, event.sender, () => settings))
  ipcMain.handle('job:cancel', (_event, jobId) => cancelJob(jobId))
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
    await wait(250)
  }
  throw new Error('界面未在 10 秒内加载完成')
}

async function waitFor(win, expression, timeout = 90000, interval = 250) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await win.webContents.executeJavaScript(expression)
    if (value) return value
    await wait(interval)
  }
  throw new Error(`等待超时：${expression}`)
}

async function waitForJobOrError(win, testId, timeout) {
  const result = await waitFor(win, `(() => {
    const error = document.querySelector('.toast.error .toast-message')
    if (error) return 'ERROR:' + error.textContent
    return document.querySelector('[data-testid="${testId}"]') ? 'OK' : ''
  })()`, timeout)
  if (result.startsWith('ERROR:')) throw new Error(result.slice(6))
}

async function capture(win, name) {
  fs.mkdirSync(screenshotsDir, { recursive: true })
  const image = await win.webContents.capturePage()
  fs.writeFileSync(path.join(screenshotsDir, `${name}.png`), image.toPNG())
  console.log(`  ✓ 截图 docs/screenshots/${name}.png`)
}

async function runBlurFlow(win) {
  console.log('\n[1/2] 去水印 UI 流程')
  await win.webContents.executeJavaScript("location.hash = '#/blur'")
  await waitFor(win, 'Boolean(document.querySelector(\'[data-testid="blur-upload"]\'))')
  await win.webContents.executeJavaScript('document.querySelector(\'[data-testid="blur-upload"]\').click()')

  await waitFor(win, `(() => {
    const video = document.querySelector('.stage-video')
    return Boolean(document.querySelector('[data-testid="blur-stage"]') && video && video.readyState >= 2)
  })()`, 30000)
  await wait(600)

  await win.webContents.executeJavaScript(`(() => {
    const stage = document.querySelector('[data-testid="blur-stage"]')
    const rect = stage.getBoundingClientRect()
    const startX = rect.left + rect.width * 0.1
    const startY = rect.top + rect.height * 0.15
    const endX = rect.left + rect.width * 0.5
    const endY = rect.top + rect.height * 0.4
    const base = { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true }
    stage.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: startX, clientY: startY, button: 0, buttons: 1 }))
    window.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: endX, clientY: endY, buttons: 1 }))
    window.dispatchEvent(new PointerEvent('pointerup', { ...base, clientX: endX, clientY: endY, button: 0, buttons: 0 }))
    return true
  })()`)

  await waitFor(win, 'Boolean(document.querySelector(\'[data-testid="region-row"]\'))')
  await wait(500)
  await capture(win, '07-blur-active')

  const ready = await win.webContents.executeJavaScript(
    '!document.querySelector(\'[data-testid="blur-process"]\').disabled',
  )
  if (!ready) throw new Error('区域已框选，但“一键处理”按钮仍不可用')

  await win.webContents.executeJavaScript('document.querySelector(\'[data-testid="blur-process"]\').click()')
  await waitForJobOrError(win, 'blur-result', 120000)
  await wait(500)
  await capture(win, '09-blur-result')

  const output = blurOutput
  if (!fs.existsSync(output)) throw new Error('去水印输出文件不存在')
  const probe = await probeMedia(ffprobePath, output)
  if (probe.video.width !== 640 || probe.video.height !== 360) throw new Error('去水印输出分辨率异常')
  if (!probe.audio) throw new Error('去水印输出丢失音轨')
  console.log(`  ✓ 去水印完成：${probe.duration.toFixed(2)}s，${probe.video.width}x${probe.video.height}`)
  return output
}

async function runJoinFlow(win) {
  console.log('\n[2/2] 拼接 UI 流程')
  await win.webContents.executeJavaScript("location.hash = '#/joiner'")
  await waitFor(win, 'Boolean(document.querySelector(\'[data-testid="joiner-add"]\'))')

  for (let i = 1; i <= 2; i += 1) {
    await win.webContents.executeJavaScript('document.querySelector(\'[data-testid="joiner-add"]\').click()')
    await waitFor(win, `document.querySelectorAll('[data-testid="queue-item"]').length >= ${i}`)
    await waitFor(win, `document.querySelectorAll('[data-testid="queue-item"] .item-meta:not(.probing)').length >= ${i}`, 30000)
    await wait(300)
  }
  await wait(500)
  await capture(win, '08-joiner-queue')

  const ready = await win.webContents.executeJavaScript(
    '!document.querySelector(\'[data-testid="join-start"]\').disabled',
  )
  if (!ready) throw new Error('两段素材已就绪，但“开始拼接”按钮仍不可用')

  await win.webContents.executeJavaScript('document.querySelector(\'[data-testid="join-start"]\').click()')
  await waitForJobOrError(win, 'join-result', 120000)

  const output = joinOutput
  if (!fs.existsSync(output)) throw new Error('拼接输出文件不存在')
  const probe = await probeMedia(ffprobePath, output)
  if (probe.duration < 5.5 || probe.duration > 6.6) throw new Error(`拼接时长异常：${probe.duration}`)
  const resultText = await win.webContents.executeJavaScript(
    'document.querySelector(\'[data-testid="join-result"]\').textContent',
  )
  if (!resultText.includes('无损快速拼接')) throw new Error('拼接应命中无损快速路径')
  console.log(`  ✓ 无损拼接完成：${probe.duration.toFixed(2)}s`)
  return output
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
    backgroundColor: '#f2f5f4',
    webPreferences: {
      preload: path.join(__dirname, '../src/preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })

  const consoleErrors = []
  win.webContents.on('console-message', (details) => {
    if (details?.level === 'error' || details?.level === 3) {
      consoleErrors.push(details.message)
    }
  })

  await win.loadFile(rendererFile)
  await waitForUi(win)

  await runBlurFlow(win)
  await runJoinFlow(win)

  if (consoleErrors.length) {
    throw new Error(`渲染进程出现 error 日志：\n${consoleErrors.join('\n')}`)
  }
  console.log('\n✓ UI 流程测试通过')
}

main()
  .then(() => app.quit())
  .catch((error) => {
    console.error(`\n✗ UI 流程测试失败：${error.message}`)
    app.exit(1)
  })
  .finally(() => {
    if (process.exitCode !== 1) fs.rmSync(workDir, { recursive: true, force: true })
  })
