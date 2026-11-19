'use strict'

const { runCapture } = require('./runner')

/*
 * 硬件编码探测：
 * - 仅“编译进了 ffmpeg”不代表机器上真的有对应硬件，因此对每个候选编码器做一次
 *   极小尺寸的真实编码测试，成功才算可用。
 * - 探测结果按 ffmpeg 路径缓存，设置页可以强制重新检测。
 * - 任何一步失败都静默回退到 libx264，不影响功能。
 */

const CANDIDATES = {
  darwin: ['h264_videotoolbox'],
  win32: ['h264_nvenc', 'h264_qsv', 'h264_amf'],
  linux: ['h264_nvenc', 'h264_qsv'],
}

const LABELS = {
  h264_videotoolbox: 'Apple VideoToolbox',
  h264_nvenc: 'NVIDIA NVENC',
  h264_qsv: 'Intel Quick Sync',
  h264_amf: 'AMD AMF',
}

const cache = new Map()

async function listEncoders(ffmpegPath) {
  const { stdout } = await runCapture(ffmpegPath, ['-hide_banner', '-encoders'], { timeout: 20000 })
  return stdout
}

async function testEncoder(ffmpegPath, encoder) {
  try {
    await runCapture(ffmpegPath, [
      '-hide_banner',
      '-loglevel', 'error',
      '-f', 'lavfi',
      '-i', 'color=c=black:s=256x144:r=30:d=0.3',
      '-frames:v', '3',
      '-an',
      '-c:v', encoder,
      '-b:v', '800k',
      '-pix_fmt', 'yuv420p',
      '-f', 'null',
      '-',
    ], { timeout: 20000 })
    return true
  } catch {
    return false
  }
}

async function detectHardwareEncoder(ffmpegPath) {
  const candidates = CANDIDATES[process.platform] || []
  if (!candidates.length) return null

  let encoderList = ''
  try {
    encoderList = await listEncoders(ffmpegPath)
  } catch {
    return null
  }

  for (const encoder of candidates) {
    if (!encoderList.includes(encoder)) continue
    if (await testEncoder(ffmpegPath, encoder)) return encoder
  }
  return null
}

/**
 * @returns {Promise<string|null>} 可用的硬件 H.264 编码器名称。
 */
function getHardwareEncoder(ffmpegPath, { force = false } = {}) {
  if (!ffmpegPath) return Promise.resolve(null)
  if (!force && cache.has(ffmpegPath)) return cache.get(ffmpegPath)

  const pending = detectHardwareEncoder(ffmpegPath)
    .catch(() => null)
    .then((encoder) => {
      // 失败结果也缓存，避免每次处理都重新探测。
      return encoder
    })
  cache.set(ffmpegPath, pending)
  return pending
}

function hardwareEncoderLabel(encoder) {
  if (!encoder) return ''
  return LABELS[encoder] || encoder
}

/** 硬件编码参数。没有 CRF 可用，统一用目标码率 + 峰值码率控制体积。 */
function buildHardwareVideoArgs(encoder, bitrateKbps) {
  const bitrate = Math.max(200, Math.round(Number(bitrateKbps) || 1000))
  const args = ['-c:v', encoder]

  if (encoder === 'h264_videotoolbox') {
    args.push('-b:v', `${bitrate}k`, '-allow_sw', '1')
  } else if (encoder === 'h264_nvenc') {
    args.push(
      '-preset', 'p1',
      '-tune', 'hq',
      '-rc', 'vbr',
      '-b:v', `${bitrate}k`,
      '-maxrate', `${Math.round(bitrate * 1.4)}k`,
      '-bufsize', `${Math.round(bitrate * 2)}k`,
    )
  } else if (encoder === 'h264_qsv') {
    args.push(
      '-preset', 'veryfast',
      '-b:v', `${bitrate}k`,
      '-maxrate', `${Math.round(bitrate * 1.4)}k`,
      '-bufsize', `${Math.round(bitrate * 2)}k`,
    )
  } else if (encoder === 'h264_amf') {
    args.push(
      '-quality', 'speed',
      '-rc', 'vbr_peak',
      '-b:v', `${bitrate}k`,
      '-maxrate', `${Math.round(bitrate * 1.4)}k`,
      '-bufsize', `${Math.round(bitrate * 2)}k`,
    )
  } else {
    args.push('-b:v', `${bitrate}k`)
  }

  return args
}

/** 软件编码参数：源码率已知时对齐源码率，否则用 CRF。 */
function buildSoftwareVideoArgs({ targetBitrateKbps = 0, preset = 'veryfast', crf = 20 } = {}) {
  const args = ['-c:v', 'libx264', '-preset', preset]
  if (targetBitrateKbps > 0) {
    args.push(
      '-b:v', `${Math.round(targetBitrateKbps)}k`,
      '-maxrate', `${Math.round(targetBitrateKbps * 1.4)}k`,
      '-bufsize', `${Math.round(targetBitrateKbps * 2)}k`,
    )
  } else {
    args.push('-crf', String(crf))
  }
  return args
}

module.exports = {
  getHardwareEncoder,
  detectHardwareEncoder,
  hardwareEncoderLabel,
  buildHardwareVideoArgs,
  buildSoftwareVideoArgs,
  LABELS,
}
