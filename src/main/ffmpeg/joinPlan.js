'use strict'

/*
 * 纯函数：视频拼接的判定与参数。与浏览器版保持一致：
 * 1. 所有素材都是 H.264 且关键参数一致时，使用 concat demuxer + stream copy，
 *    不重新编码，速度最快且画质不变。
 * 2. 参数不一致时，以第一段视频方向确定输出画布（长边 1280 / 短边 720），
 *    逐段等比缩放、补黑边、统一为 H.264/AAC 30fps 后再 stream copy 合并。
 */

const MAX_OUTPUT_LONG_EDGE = 1280
const MAX_OUTPUT_SHORT_EDGE = 720
const NORMALIZE_FPS = 30

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function parseFrameRate(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (!value) return 0
  const [numerator, denominator] = String(value).split('/').map(Number)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0
  return numerator / denominator
}

function frameRateEqual(a, b, tolerance = 0.01) {
  const rateA = parseFrameRate(a)
  const rateB = parseFrameRate(b)
  if (!rateA || !rateB) return rateA === rateB
  return Math.abs(rateA - rateB) <= tolerance
}

/**
 * 判断能否安全地直接 stream copy 拼接。
 * 只要有一条流参数可能影响解码/播放，就走转码路径，避免输出花屏或音画不同步。
 */
function canStreamCopy(probes) {
  if (!Array.isArray(probes) || probes.length === 0) return false
  const first = probes[0]
  if (!first.video || first.video.codec !== 'h264') return false

  return probes.every((probe) => {
    if (!probe.video || probe.video.codec !== 'h264') return false
    if (probe.video.width !== first.video.width || probe.video.height !== first.video.height) return false
    if (probe.video.pixFmt !== first.video.pixFmt) return false
    if ((probe.video.profile || '') !== (first.video.profile || '')) return false
    if (!frameRateEqual(probe.video.fps, first.video.fps)) return false
    if ((probe.video.rotation || 0) !== (first.video.rotation || 0)) return false
    if (Boolean(probe.audio) !== Boolean(first.audio)) return false
    if (probe.audio) {
      if (probe.audio.codec !== first.audio.codec) return false
      if (probe.audio.sampleRate !== first.audio.sampleRate) return false
      if (probe.audio.channels !== first.audio.channels) return false
    }
    return true
  })
}

/** 输出画布：方向跟随第一段视频，限制在 1280x720（或 720x1280）以内。 */
function computeTargetSize(width, height) {
  const sourceWidth = width || 1280
  const sourceHeight = height || 720
  const isPortrait = sourceHeight > sourceWidth
  const maxWidth = isPortrait ? MAX_OUTPUT_SHORT_EDGE : MAX_OUTPUT_LONG_EDGE
  const maxHeight = isPortrait ? MAX_OUTPUT_LONG_EDGE : MAX_OUTPUT_SHORT_EDGE
  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight)
  return {
    width: Math.max(2, Math.floor((sourceWidth * scale) / 2) * 2),
    height: Math.max(2, Math.floor((sourceHeight * scale) / 2) * 2),
  }
}

/** 逐段标准化滤镜：等比缩放 -> 补黑边 -> 统一像素格式/帧率。 */
function buildNormalizeFilter(target) {
  return [
    `scale=${target.width}:${target.height}:force_original_aspect_ratio=decrease`,
    `pad=${target.width}:${target.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'setsar=1',
    `fps=${NORMALIZE_FPS}`,
    'format=yuv420p',
  ].join(',')
}

/** 硬件编码没有 CRF 的概念，按分辨率估算一个观感适中的目标码率。 */
function estimateVideoBitrateKbps(width, height, fps = NORMALIZE_FPS) {
  const pixels = Math.max(1, Number(width) || 1280) * Math.max(1, Number(height) || 720)
  return Math.round(clamp((pixels * fps * 0.1) / 1000, 400, 20000))
}

/** 输出码率优先取源视频流自身码率，其次用总码率减音频码率估算。 */
function resolveVideoBitrateKbps(videoInfo, formatBitrateBps = 0, fileSize = 0) {
  if (videoInfo.videoBitRate > 0) return Math.round(videoInfo.videoBitRate / 1000)
  const audioKbps = videoInfo.audio && videoInfo.audio.bitRate > 0 ? videoInfo.audio.bitRate / 1000 : 0
  if (formatBitrateBps > 0) return Math.max(50, Math.round(formatBitrateBps / 1000 - audioKbps))
  if (videoInfo.duration > 0 && fileSize > 0) {
    const totalKbps = (fileSize * 8) / videoInfo.duration / 1000
    return Math.max(50, Math.round(totalKbps - audioKbps))
  }
  return 0
}

/**
 * ffmpeg concat demuxer 的路径转义。Windows 反斜杠统一转成正斜杠，
 * 单引号按 '\'' 规则转义，避免带空格、引号或中文的路径解析失败。
 */
function escapeConcatPath(filePath) {
  return String(filePath).replace(/\\/g, '/').replace(/'/g, "'\\''")
}

function buildConcatList(filePaths) {
  return filePaths.map((filePath) => `file '${escapeConcatPath(filePath)}'`).join('\n') + '\n'
}

module.exports = {
  MAX_OUTPUT_LONG_EDGE,
  MAX_OUTPUT_SHORT_EDGE,
  NORMALIZE_FPS,
  parseFrameRate,
  frameRateEqual,
  canStreamCopy,
  computeTargetSize,
  buildNormalizeFilter,
  estimateVideoBitrateKbps,
  resolveVideoBitrateKbps,
  escapeConcatPath,
  buildConcatList,
}
