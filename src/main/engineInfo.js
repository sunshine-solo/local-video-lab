'use strict'

const { resolveBinaries, ensureExecutable } = require('./ffmpeg/binaries')
const { runCapture } = require('./ffmpeg/runner')
const { getHardwareEncoder, hardwareEncoderLabel } = require('./ffmpeg/encoders')

const parseVersion = (output, tool) => {
  const match = String(output || '').match(new RegExp(`${tool}\\s+version\\s+([^\\s]+)`, 'i'))
  return match ? match[1] : ''
}

async function readVersion(binary, tool) {
  const { stdout, stderr } = await runCapture(binary, ['-version'], { timeout: 15000 })
  return parseVersion(`${stdout}\n${stderr}`, tool)
}

/**
 * 引擎状态：内置/自定义路径、FFmpeg/FFprobe 版本、可用的硬件编码器。
 * 硬件探测会做一次真实小视频编码，第一次调用可能需要 1-3 秒，结果会被缓存。
 */
async function getEngineInfo(settings, { force = false } = {}) {
  const binaries = resolveBinaries(settings)
  ensureExecutable(binaries.ffmpeg)
  ensureExecutable(binaries.ffprobe)

  const info = {
    platform: process.platform,
    arch: process.arch,
    bundledFfmpeg: binaries.bundledFfmpeg,
    bundledFfprobe: binaries.bundledFfprobe,
    ffmpegPath: binaries.ffmpeg,
    ffprobePath: binaries.ffprobe,
    usingCustomFfmpeg: binaries.usingCustomFfmpeg,
    usingCustomFfprobe: binaries.usingCustomFfprobe,
    ffmpegVersion: '',
    ffprobeVersion: '',
    hardwareEncoder: null,
    hardwareEncoderLabel: '',
    hardwareAcceleration: settings.hardwareAcceleration !== false,
    error: '',
  }

  try {
    info.ffmpegVersion = await readVersion(binaries.ffmpeg, 'ffmpeg')
  } catch (error) {
    info.error = `FFmpeg 不可用：${error.message}`
    return info
  }

  try {
    info.ffprobeVersion = await readVersion(binaries.ffprobe, 'ffprobe')
  } catch {
    info.ffprobeVersion = '未知'
  }

  try {
    const encoder = await getHardwareEncoder(binaries.ffmpeg, { force })
    info.hardwareEncoder = encoder
    info.hardwareEncoderLabel = hardwareEncoderLabel(encoder)
  } catch {
    info.hardwareEncoder = null
  }

  return info
}

/** 测试一组自定义路径，不写入设置。 */
async function testBinaries({ ffmpegPath = '', ffprobePath = '' } = {}) {
  const binaries = resolveBinaries({ ffmpegPath, ffprobePath })
  ensureExecutable(binaries.ffmpeg)
  ensureExecutable(binaries.ffprobe)
  const result = { ok: true, ffmpegVersion: '', ffprobeVersion: '', error: '' }
  try {
    result.ffmpegVersion = await readVersion(binaries.ffmpeg, 'ffmpeg')
  } catch (error) {
    return { ...result, ok: false, error: `FFmpeg 不可用：${error.message}` }
  }
  try {
    result.ffprobeVersion = await readVersion(binaries.ffprobe, 'ffprobe')
  } catch (error) {
    return { ...result, ok: false, error: `FFprobe 不可用：${error.message}` }
  }
  return result
}

module.exports = {
  getEngineInfo,
  testBinaries,
  parseVersion,
}
