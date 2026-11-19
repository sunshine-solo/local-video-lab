'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { resolveBinaries, ensureExecutable } = require('./binaries')
const { probeMedia } = require('./probe')
const {
  canStreamCopy,
  computeTargetSize,
  buildNormalizeFilter,
  estimateVideoBitrateKbps,
  buildConcatList,
} = require('./joinPlan')
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
  createTempDir,
  removeTempDir,
} = require('./output')

const MIN_ITEMS = 2
const MAX_ITEMS = 6

function normalizeJoinPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('参数无效')
  const outputPath = String(payload.outputPath || '')
  if (!outputPath) throw new Error('请选择输出位置')
  if (!/^\.mp4$/i.test(path.extname(outputPath))) throw new Error('输出文件必须是 .mp4 格式')

  const items = Array.isArray(payload.items) ? payload.items : []
  if (items.length < MIN_ITEMS) throw new Error('至少添加 2 段视频')
  if (items.length > MAX_ITEMS) throw new Error(`最多支持 ${MAX_ITEMS} 段视频`)

  const paths = items.map((item) => String(typeof item === 'string' ? item : item?.path || ''))
  if (paths.some((itemPath) => !itemPath)) throw new Error('视频列表中存在无效文件')
  const outputResolved = path.resolve(outputPath)
  if (paths.some((itemPath) => path.resolve(itemPath) === outputResolved)) {
    throw new Error('输出文件不能与素材文件相同，请换一个文件名')
  }

  return { paths, outputPath }
}

const fingerprintOf = (probe) => `${probe.path}:${probe.size}:${probe.mtimeMs}`

function buildNormalizeArgs(probe, target, encoder, segmentPath) {
  const filter = buildNormalizeFilter(target)
  const videoArgs = encoder
    ? buildHardwareVideoArgs(encoder, estimateVideoBitrateKbps(target.width, target.height))
    : buildSoftwareVideoArgs({ preset: 'ultrafast', crf: 23 })

  const inputs = ['-i', probe.path]
  if (!probe.audio) {
    inputs.push('-f', 'lavfi')
    // 有些容器读不到时长，此时让 anullsrc 持续输出，由 -shortest 跟随视频结束。
    if (probe.duration > 0) inputs.push('-t', String(probe.duration))
    inputs.push('-i', 'anullsrc=r=44100:cl=stereo')
  }

  const audioArgs = probe.audio
    ? [
        '-map', '0:a:0',
        '-af', 'aresample=44100:async=1:first_pts=0,aformat=sample_rates=44100:channel_layouts=stereo',
        '-c:a', 'aac', '-b:a', '128k',
      ]
    : [
        '-map', '1:a:0',
        '-shortest',
        '-c:a', 'aac', '-b:a', '128k',
      ]

  return [
    '-y',
    ...inputs,
    '-map', '0:v:0',
    ...audioArgs,
    '-vf', filter,
    ...videoArgs,
    '-movflags', '+faststart',
    segmentPath,
  ]
}

/**
 * 视频拼接任务。
 * 所有素材参数一致时直接无损拼接；否则逐段标准化后再无损合并。
 * 重复素材（例如 A-B-A）只会转码一次，其余直接复用。
 */
async function runJoinJob({ payload, settings = {}, emit, registerChild, isCancelled }) {
  const options = normalizeJoinPayload(payload)
  await assertOutputDirectory(options.outputPath)

  const binaries = resolveBinaries(settings)
  ensureExecutable(binaries.ffmpeg)
  ensureExecutable(binaries.ffprobe)
  const workPath = makeWorkPath(options.outputPath, payload.jobId)

  const probes = []
  for (let index = 0; index < options.paths.length; index += 1) {
    emit({
      phase: 'probe',
      percent: 2 + (index / options.paths.length) * 5,
      message: `正在分析第 ${index + 1}/${options.paths.length} 段视频`,
      detail: path.basename(options.paths[index]),
    })
    try {
      probes.push(await probeMedia(binaries.ffprobe, options.paths[index]))
    } catch (error) {
      throw new Error(`第 ${index + 1} 段视频无法读取：${error.message}`)
    }
    if (isCancelled()) throw new JobCancelledError()
  }

  const totalDuration = probes.reduce((sum, probe) => sum + (probe.duration || 0), 0)

  let hardwareEncoder = null
  if (settings.hardwareAcceleration !== false) {
    hardwareEncoder = await getHardwareEncoder(binaries.ffmpeg)
    if (isCancelled()) throw new JobCancelledError()
  }

  try {
    // 1) 快速路径：参数一致的 H.264 素材直接 stream copy。
    if (canStreamCopy(probes)) {
      const copied = await tryStreamCopy({
        binaries,
        paths: options.paths,
        workPath,
        totalDuration,
        emit,
        registerChild,
        isCancelled,
      })
      if (copied) {
        if (isCancelled()) throw new JobCancelledError()
        emit({ phase: 'finalize', percent: 97, message: '正在写入结果文件', detail: path.basename(options.outputPath) })
        await commitOutput(workPath, options.outputPath)
        const stat = await fs.promises.stat(options.outputPath)
        emit({ phase: 'done', percent: 100, message: '拼接完成', detail: path.basename(options.outputPath) })
        return {
          outputPath: options.outputPath,
          size: stat.size,
          mode: 'copy',
          encoder: null,
          encoderLabel: '',
          width: probes[0].video.width,
          height: probes[0].video.height,
          duration: totalDuration,
        }
      }
    }

    // 2) 标准化路径：统一画布、帧率、编码参数后再合并。
    const target = computeTargetSize(probes[0].video.width, probes[0].video.height)
    const tempDir = await createTempDir()
    const normalizedByFingerprint = new Map()
    const normalizedPaths = []

    const uniqueDurations = new Map()
    for (const probe of probes) {
      const fingerprint = fingerprintOf(probe)
      if (!uniqueDurations.has(fingerprint)) uniqueDurations.set(fingerprint, probe.duration || 0)
    }
    const uniqueTotalDuration = [...uniqueDurations.values()].reduce((sum, value) => sum + value, 0) || totalDuration || 1
    let encodedDuration = 0

    try {
      for (let index = 0; index < probes.length; index += 1) {
        const probe = probes[index]
        const fingerprint = fingerprintOf(probe)
        const cachedPath = normalizedByFingerprint.get(fingerprint)
        if (cachedPath) {
          normalizedPaths.push(cachedPath)
          continue
        }

        const segmentPath = path.join(tempDir, `normalized_${index}.mp4`)
        normalizedByFingerprint.set(fingerprint, segmentPath)
        normalizedPaths.push(segmentPath)
        const segmentDuration = probe.duration || 0
        const progressBase = 8 + (encodedDuration / uniqueTotalDuration) * 76
        const progressSpan = Math.max(0.01, segmentDuration / uniqueTotalDuration) * 76

        const engineLabel = hardwareEncoder ? hardwareEncoderLabel(hardwareEncoder) : 'libx264 软件编码'
        const runSegment = async (encoder) => {
          emit({
            phase: 'encode',
            percent: progressBase,
            message: `正在转码第 ${index + 1}/${probes.length} 段`,
            detail: `${target.width} × ${target.height} · ${engineLabel}`,
          })
          await runFfmpeg({
            ffmpegPath: binaries.ffmpeg,
            args: buildNormalizeArgs(probe, target, encoder, segmentPath),
            durationSeconds: segmentDuration,
            registerChild,
            isCancelled,
            onProgress: (ratio) => {
              emit({
                phase: 'encode',
                percent: progressBase + ratio * progressSpan,
                message: `正在转码第 ${index + 1}/${probes.length} 段`,
                detail: `${target.width} × ${target.height} · ${engineLabel}`,
              })
            },
          })
        }

        if (hardwareEncoder) {
          try {
            await runSegment(hardwareEncoder)
          } catch (error) {
            if (error instanceof JobCancelledError || isCancelled()) throw error
            await discardFile(segmentPath)
            hardwareEncoder = null
            emit({
              phase: 'encode',
              percent: progressBase,
              message: '硬件编码不可用，已切换软件编码',
              detail: 'libx264 软件编码',
            })
            await runSegment(null)
          }
        } else {
          await runSegment(null)
        }

        encodedDuration += segmentDuration
      }

      const listPath = path.join(tempDir, 'normalized_list.txt')
      await fs.promises.writeFile(listPath, buildConcatList(normalizedPaths), 'utf8')
      emit({
        phase: 'concat',
        percent: 86,
        message: '正在合并标准化视频',
        detail: '无损写入最终 MP4',
      })
      await runFfmpeg({
        ffmpegPath: binaries.ffmpeg,
        args: [
          '-y',
          '-f', 'concat',
          '-safe', '0',
          '-i', listPath,
          '-map', '0:v:0',
          '-map', '0:a:0',
          '-c', 'copy',
          '-avoid_negative_ts', 'make_zero',
          '-movflags', '+faststart',
          workPath,
        ],
        durationSeconds: totalDuration,
        registerChild,
        isCancelled,
        onProgress: (ratio) => {
          emit({
            phase: 'concat',
            percent: 86 + ratio * 11,
            message: '正在合并标准化视频',
            detail: '无损写入最终 MP4',
          })
        },
      })

      if (isCancelled()) throw new JobCancelledError()

      emit({ phase: 'finalize', percent: 97, message: '正在写入结果文件', detail: path.basename(options.outputPath) })
      await commitOutput(workPath, options.outputPath)
      const stat = await fs.promises.stat(options.outputPath)
      emit({ phase: 'done', percent: 100, message: '拼接完成', detail: path.basename(options.outputPath) })
      return {
        outputPath: options.outputPath,
        size: stat.size,
        mode: 'transcode',
        encoder: hardwareEncoder,
        encoderLabel: hardwareEncoder ? hardwareEncoderLabel(hardwareEncoder) : 'libx264',
        width: target.width,
        height: target.height,
        duration: totalDuration,
      }
    } finally {
      await removeTempDir(tempDir)
    }
  } finally {
    await discardFile(workPath)
  }
}

/** 尝试无损拼接。失败（非取消）时返回 false，由调用方转入转码路径。 */
async function tryStreamCopy({
  binaries,
  paths,
  workPath,
  totalDuration,
  emit,
  registerChild,
  isCancelled,
}) {
  const tempDir = await createTempDir()
  try {
    const listPath = path.join(tempDir, 'concat_list.txt')
    await fs.promises.writeFile(listPath, buildConcatList(paths), 'utf8')
    emit({
      phase: 'copy',
      percent: 10,
      message: '正在无损快速拼接',
      detail: '素材参数一致，跳过视频重新编码',
    })
    await runFfmpeg({
      ffmpegPath: binaries.ffmpeg,
      args: [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', listPath,
        '-map', '0:v:0',
        '-map', '0:a?',
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
        '-movflags', '+faststart',
        workPath,
      ],
      durationSeconds: totalDuration,
      registerChild,
      isCancelled,
      onProgress: (ratio) => {
        emit({
          phase: 'copy',
          percent: 10 + ratio * 84,
          message: '正在无损快速拼接',
          detail: '素材参数一致，跳过视频重新编码',
        })
      },
    })
    return true
  } catch (error) {
    if (error instanceof JobCancelledError || isCancelled()) throw error
    await discardFile(workPath)
    emit({
      phase: 'prepare',
      percent: 8,
      message: '无损拼接未成功，正在转入标准化转码',
      detail: '将统一分辨率与编码参数后重新合并',
    })
    return false
  } finally {
    await removeTempDir(tempDir)
  }
}

module.exports = {
  runJoinJob,
  normalizeJoinPayload,
  buildNormalizeArgs,
}
