'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { runCapture } = require('./runner')
const { parseFrameRate } = require('./joinPlan')

const toNumber = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

const normalizeRotation = (value) => {
  const number = toNumber(value)
  return ((Math.round(number) % 360) + 360) % 360
}

/**
 * 通过 ffprobe JSON 读取媒体信息。
 * width/height 返回的是“显示尺寸”：手机竖拍视频带旋转矩阵时 ffmpeg 会自动旋转，
 * 因此这里对 90/270 度做宽高交换，滤镜坐标与预览都以显示尺寸为准。
 */
async function probeMedia(ffprobePath, filePath) {
  if (!filePath || typeof filePath !== 'string') throw new Error('无效的视频路径')

  let stat
  try {
    stat = await fs.promises.stat(filePath)
  } catch {
    throw new Error(`文件不存在或无法读取：${path.basename(filePath)}`)
  }
  if (!stat.isFile()) throw new Error('请选择一个视频文件')

  let parsed
  try {
    const { stdout } = await runCapture(ffprobePath, [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ], { timeout: 30000 })
    parsed = JSON.parse(stdout)
  } catch (error) {
    throw new Error(`无法解析视频信息：${error.stderr?.trim() || error.message}`)
  }

  const streams = Array.isArray(parsed.streams) ? parsed.streams : []
  const videoStream = streams.find(
    (stream) => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1,
  )
  if (!videoStream) throw new Error('该文件没有视频画面')

  const audioStream = streams.find((stream) => stream.codec_type === 'audio') || null
  const format = parsed.format || {}

  let rotation = 0
  const rotationSideData = Array.isArray(videoStream.side_data_list)
    ? videoStream.side_data_list.find((item) => typeof item.rotation === 'number')
    : null
  if (rotationSideData) rotation = normalizeRotation(rotationSideData.rotation)
  else if (videoStream.tags?.rotate != null) rotation = normalizeRotation(videoStream.tags.rotate)

  const codedWidth = toNumber(videoStream.width)
  const codedHeight = toNumber(videoStream.height)
  const displayWidth = rotation === 90 || rotation === 270 ? codedHeight : codedWidth
  const displayHeight = rotation === 90 || rotation === 270 ? codedWidth : codedHeight

  const fps = parseFrameRate(videoStream.avg_frame_rate) || parseFrameRate(videoStream.r_frame_rate)
  const duration = toNumber(format.duration) || toNumber(videoStream.duration) || 0

  return {
    path: filePath,
    name: path.basename(filePath),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    duration,
    formatName: format.format_name || '',
    formatBitRate: toNumber(format.bit_rate),
    video: {
      codec: String(videoStream.codec_name || '').toLowerCase(),
      codecLongName: videoStream.codec_long_name || '',
      width: displayWidth,
      height: displayHeight,
      codedWidth,
      codedHeight,
      rotation,
      pixFmt: videoStream.pix_fmt || '',
      fps: Math.round(fps * 1000) / 1000,
      bitRate: toNumber(videoStream.bit_rate),
      profile: videoStream.profile || '',
      level: videoStream.level || null,
    },
    audio: audioStream
      ? {
          codec: String(audioStream.codec_name || '').toLowerCase(),
          sampleRate: toNumber(audioStream.sample_rate),
          channels: toNumber(audioStream.channels),
          channelLayout: audioStream.channel_layout || '',
          bitRate: toNumber(audioStream.bit_rate),
          profile: audioStream.profile || '',
        }
      : null,
  }
}

module.exports = {
  probeMedia,
  normalizeRotation,
}
