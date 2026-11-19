'use strict'

const fs = require('node:fs')
const path = require('node:path')

/**
 * 定位 FFmpeg / FFprobe。
 * 优先使用用户在设置里指定的路径；其次使用安装包 resources/bin 中的内置二进制；
 * 开发环境回退到 node_modules，再回退到系统 PATH。
 */

const isUsable = (filePath) => {
  if (!filePath) return false
  // 允许用户填写 PATH 中的命令名（例如 "ffmpeg"），绝对路径则检查是否真实存在。
  if (!path.isAbsolute(filePath)) return true
  try {
    fs.accessSync(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

const fixAsarPath = (filePath) => {
  if (!filePath || !filePath.includes('app.asar')) return filePath
  return filePath.replace(/app\.asar([\\/])/g, 'app.asar.unpacked$1')
}

function packagedBinaries() {
  // 打包后二进制位于 <app>/Contents/Resources/bin（mac）或 resources/bin（win）。
  // 这里不 require('electron')，以便在普通 Node 测试里复用本模块。
  if (!process.resourcesPath || process.defaultApp) return null
  const directory = path.join(process.resourcesPath, 'bin')
  const ffmpeg = path.join(directory, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  const ffprobe = path.join(directory, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
  if (fs.existsSync(ffmpeg)) {
    return {
      ffmpeg,
      ffprobe: fs.existsSync(ffprobe) ? ffprobe : '',
    }
  }
  return null
}

function bundledBinaries() {
  const packaged = packagedBinaries()
  if (packaged) return packaged

  let ffmpeg = ''
  let ffprobe = ''
  try {
    ffmpeg = fixAsarPath(require('ffmpeg-static'))
  } catch (error) {
    console.warn('未能加载内置 ffmpeg:', error.message)
  }
  try {
    ffprobe = fixAsarPath(require('@ffprobe-installer/ffprobe').path)
  } catch (error) {
    console.warn('未能加载内置 ffprobe:', error.message)
  }
  return { ffmpeg, ffprobe }
}

function resolveBinaries(settings = {}) {
  const bundled = bundledBinaries()
  const ffprobeExecutable = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'

  let ffmpeg = String(settings.ffmpegPath || '').trim()
  if (!isUsable(ffmpeg)) ffmpeg = ''
  if (!ffmpeg) ffmpeg = bundled.ffmpeg && fs.existsSync(bundled.ffmpeg) ? bundled.ffmpeg : 'ffmpeg'

  let ffprobe = String(settings.ffprobePath || '').trim()
  if (!isUsable(ffprobe)) ffprobe = ''
  if (!ffprobe) {
    // 自定义 ffmpeg 时，优先使用同目录下的 ffprobe。
    if (path.isAbsolute(ffmpeg)) {
      const sibling = path.join(path.dirname(ffmpeg), ffprobeExecutable)
      if (isUsable(sibling)) ffprobe = sibling
    }
    if (!ffprobe) ffprobe = bundled.ffprobe && fs.existsSync(bundled.ffprobe) ? bundled.ffprobe : 'ffprobe'
  }

  return {
    ffmpeg,
    ffprobe,
    bundledFfmpeg: bundled.ffmpeg,
    bundledFfprobe: bundled.ffprobe,
    usingCustomFfmpeg: Boolean(settings.ffmpegPath) && ffmpeg === String(settings.ffmpegPath).trim(),
    usingCustomFfprobe: Boolean(settings.ffprobePath) && ffprobe === String(settings.ffprobePath).trim(),
  }
}

/** 某些打包/解压流程会丢失可执行位，启动前补一次权限（失败不致命）。 */
function ensureExecutable(filePath) {
  if (!filePath || process.platform === 'win32' || !path.isAbsolute(filePath)) return
  try {
    const stat = fs.statSync(filePath)
    if ((stat.mode & 0o111) === 0) fs.chmodSync(filePath, 0o755)
  } catch {
    // 只读卷或权限不足时由 spawn 报出更准确的错误。
  }
}

module.exports = {
  resolveBinaries,
  ensureExecutable,
  bundledBinaries,
  fixAsarPath,
}
