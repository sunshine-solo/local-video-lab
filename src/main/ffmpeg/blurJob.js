'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { resolveBinaries, ensureExecutable } = require('./binaries')
const { probeMedia } = require('./probe')
const { buildBlurFilterGraph } = require('./filters')
const { resolveVideoBitrateKbps, estimateVideoBitrateKbps } = require('./joinPlan')
const {
  getHardwareEncoder,
  hardwareEncoderLabel,
  buildHardwareVideoArgs,
  buildSoftwareVideoArgs,
} = require('./encoders')
const { runFfmpeg, JobCancelledError } = require('./runner')
const {
  assertOutputDirectory,
  makeWorkPath,
  discardFile,
  commitOutput,
} = require('./output')

const MAX_REGIONS = 8
const QUALITY_PRESETS = {
  standard: {
    preset: 'ultrafast',
    crf: 23,
    label: '标准转码',
  },
  high: {
    preset: 'veryfast',
    crf: 20,
    label: '精细转码',
  },
}
const COPYABLE_AUDIO = new Set(['aac', 'mp3', 'ac3', 'eac3', 'alac'])

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function normalizePayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('参数无效')
  const inputPath = String(payload.inputPath || '')
  const outputPath = String(payload.outputPath || '')
  if (!inputPath) throw new Error('请先选择视频')
  if (!outputPath) throw new Error('请选择输出位置')
  if (path.resolve(inputPath) === path.resolve(outputPath)) {
    throw new Error('输出文件不能与源文件相同，请换一个文件名')
  }
  if (!/^\.mp4$/i.test(path.extname(outputPath))) {
    throw new Error('输出文件必须是 .mp4 格式')
  }

  const mode = ['blur', 'mosaic', 'solid'].includes(payload.mode) ? payload.mode : 'blur'
  const quality = QUALITY_PRESETS[payload.quality] ? payload.quality : 'high'
  const strength = clamp(Math.round(Number(payload.strength) || 6), 1, 10)
  const color = /^#[0-9a-f]{6}$/i.test(String(payload.color || '')) ? String(payload.color) : '#000000'
  const rawRegions = Array.isArray(payload.regions) ? payload.regions : []
  if (!rawRegions.length) throw new Error('请先在画面上框选至少一个区域')
  if (rawRegions.length > MAX_REGIONS) throw new Error(`最多支持 ${MAX_REGIONS} 个区域`)

  const regions = rawRegions.map((region, index) => {
    const x = Number(region?.x)
    const y = Number(region?.y)
    const w = Number(region?.w)
    const h = Number(region?.h)
    if (![x, y, w, h].every(Number.isFinite)) throw new Error(`第 ${index + 1} 个区域坐标无效`)
    if (w <= 0 || h <= 0) throw new Error(`第 ${index + 1} 个区域尺寸无效`)
    return {
      x: clamp(x, 0, 1),
      y: clamp(y, 0, 1),
      w: clamp(w, 0.001, 1),
      h: clamp(h, 0.001, 1),
    }
  })

  return { inputPath, outputPath, mode, quality, strength, color, regions }
}

/**
 * 视频去水印任务。
 * 输出分辨率与帧率保持不变；视频码率优先对齐源视频流，避免低码率源被重新编码后
 * 体积反而变大。音频能直接 copy 就 copy。硬件编码失败时自动回退软件编码。
 */
async function runBlurJob({ payload, settings = {}, emit, registerChild, isCancelled }) {
  const options = normalizePayload(payload)
  await assertOutputDirectory(options.outputPath)

  const binaries = resolveBinaries(settings)
  ensureExecutable(binaries.ffmpeg)
  ensureExecutable(binaries.ffprobe)
  const workPath = makeWorkPath(options.outputPath, payload.jobId)
  const qualityPreset = QUALITY_PRESETS[options.quality]

  emit({ phase: 'probe', percent: 2, message: '正在分析视频', detail: path.basename(options.inputPath) })
  let probe
  try {
    probe = await probeMedia(binaries.ffprobe, options.inputPath)
  } catch (error) {
    throw new Error(error.message || '无法读取视频信息')
  }
  if (isCancelled()) throw new JobCancelledError()
  if (probe.video.width < 16 || probe.video.height < 16) {
    throw new Error('视频分辨率过小，无法处理')
  }

  const filterGraph = buildBlurFilterGraph({
    width: probe.video.width,
    height: probe.video.height,
    regions: options.regions,
    mode: options.mode,
    strength: options.strength,
    color: options.color,
  })

  const targetBitrate = resolveVideoBitrateKbps(probe.video, probe.formatBitRate, probe.size)
  const estimatedBitrate = estimateVideoBitrateKbps(probe.video.width, probe.video.height, probe.video.fps || 30)
  // 硬件编码没有 CRF，按源视频码率给目标值，避免成片体积明显大于原片。
  const hardwareBitrate = targetBitrate > 0 ? targetBitrate : estimatedBitrate

  const audioArgs = probe.audio
    ? (COPYABLE_AUDIO.has(probe.audio.codec)
        ? ['-c:a', 'copy']
        : ['-c:a', 'aac', '-b:a', `${clamp(Math.round(probe.audio.bitRate / 1000 || 128), 96, 320)}k`])
    : []

  let hardwareEncoder = null
  if (settings.hardwareAcceleration !== false) {
    emit({ phase: 'prepare', percent: 5, message: '正在检测硬件编码器', detail: '' })
    hardwareEncoder = await getHardwareEncoder(binaries.ffmpeg)
    if (isCancelled()) throw new JobCancelledError()
  }

  const buildArgs = (encoder) => {
    const videoArgs = encoder
      ? buildHardwareVideoArgs(encoder, hardwareBitrate)
      : buildSoftwareVideoArgs({
          targetBitrateKbps: targetBitrate,
          preset: qualityPreset.preset,
          crf: qualityPreset.crf,
        })

    return [
      '-y',
      '-i', options.inputPath,
      '-filter_complex', filterGraph,
      '-map', '[vout]',
      '-map', '0:a?',
      ...audioArgs,
      ...videoArgs,
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      workPath,
    ]
  }

  const engineDetail = () => {
    const encoderLabel = hardwareEncoder ? hardwareEncoderLabel(hardwareEncoder) : 'libx264 软件编码'
    return `${probe.video.width} × ${probe.video.height} · ${encoderLabel}`
  }

  const runWith = async (encoder) => {
    emit({
      phase: 'encode',
      percent: 8,
      message: '正在处理整段视频',
      detail: engineDetail(),
    })
    await runFfmpeg({
      ffmpegPath: binaries.ffmpeg,
      args: buildArgs(encoder),
      durationSeconds: probe.duration,
      registerChild,
      isCancelled,
      onProgress: (ratio) => {
        emit({
          phase: 'encode',
          percent: 8 + ratio * 88,
          message: '正在处理整段视频',
          detail: engineDetail(),
        })
      },
    })
  }

  try {
    if (hardwareEncoder) {
      try {
        await runWith(hardwareEncoder)
      } catch (error) {
        if (error instanceof JobCancelledError || isCancelled()) throw error
        await discardFile(workPath)
        hardwareEncoder = null
        emit({
          phase: 'encode',
          percent: 8,
          message: '硬件编码不可用，已切换软件编码',
          detail: 'libx264 软件编码',
        })
        await runWith(null)
      }
    } else {
      await runWith(null)
    }

    if (isCancelled()) throw new JobCancelledError()

    emit({ phase: 'finalize', percent: 97, message: '正在写入结果文件', detail: path.basename(options.outputPath) })
    await commitOutput(workPath, options.outputPath)
    const stat = await fs.promises.stat(options.outputPath)

    emit({ phase: 'done', percent: 100, message: '处理完成', detail: path.basename(options.outputPath) })
    return {
      outputPath: options.outputPath,
      size: stat.size,
      mode: hardwareEncoder ? 'hardware' : 'software',
      encoder: hardwareEncoder,
      encoderLabel: hardwareEncoder ? hardwareEncoderLabel(hardwareEncoder) : 'libx264',
      width: probe.video.width,
      height: probe.video.height,
      duration: probe.duration,
    }
  } finally {
    await discardFile(workPath)
  }
}

module.exports = {
  runBlurJob,
  normalizeBlurPayload: normalizePayload,
  QUALITY_PRESETS,
  MAX_REGIONS,
}
