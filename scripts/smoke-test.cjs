'use strict'

/*
 * 端到端冒烟测试：用内置 FFmpeg 生成测试素材，然后真实执行：
 *   1. 参数一致的视频无损拼接（stream copy）
 *   2. 参数不一致的视频标准化拼接（转码）
 *   3. 视频去水印的模糊 / 马赛克 / 纯色三种模式
 * 最后用 ffprobe 校验输出文件。
 *
 * 运行：npm run test:smoke
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const { runJoinJob } = require('../src/main/ffmpeg/joinJob')
const { runBlurJob } = require('../src/main/ffmpeg/blurJob')
const { probeMedia } = require('../src/main/ffmpeg/probe')

const ffmpegPath = require('ffmpeg-static')
const ffprobePath = require('@ffprobe-installer/ffprobe').path
const settings = { ffmpegPath, ffprobePath, hardwareAcceleration: true }

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-video-lab-smoke-'))
let failures = 0

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`${command} 执行失败：\n${result.stderr}`)
  }
  return result
}

function makeVideo(fileName, { width, height, seconds, withAudio = true }) {
  const output = path.join(workDir, fileName)
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=${width}x${height}:rate=30:duration=${seconds}`,
  ]
  if (withAudio) {
    args.push('-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=44100:duration=${seconds}`)
  }
  args.push(
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-shortest', output,
  )
  run(ffmpegPath, args)
  return output
}

const makeContext = (label) => {
  let lastMessage = ''
  return {
    settings,
    emit: (payload) => {
      if (payload.message && payload.message !== lastMessage) {
        lastMessage = payload.message
        const percent = Number.isFinite(payload.percent) ? `${payload.percent.toFixed(0)}%` : ''
        console.log(`  [${label}] ${percent} ${payload.message}${payload.detail ? ` — ${payload.detail}` : ''}`)
      }
    },
    registerChild: () => {},
    isCancelled: () => false,
  }
}

async function main() {
  console.log('生成测试素材…')
  const landscapeA = makeVideo('a.mp4', { width: 640, height: 360, seconds: 2 })
  const landscapeB = makeVideo('b.mp4', { width: 640, height: 360, seconds: 1.5 })
  const portrait = makeVideo('c.mp4', { width: 480, height: 640, seconds: 2, withAudio: false })
  console.log(`  素材目录：${workDir}`)

  console.log('\n[1/4] 无损拼接（两个同参数素材）')
  const copyOutput = path.join(workDir, 'copy.mp4')
  const copyResult = await runJoinJob({
    ...makeContext('copy'),
    payload: { jobId: 'smoke-copy', items: [{ path: landscapeA }, { path: landscapeB }], outputPath: copyOutput },
  })
  assert(copyResult.mode === 'copy', `期望 copy 模式，实际 ${copyResult.mode}`)
  const copyProbe = await probeMedia(ffprobePath, copyOutput)
  assert(copyProbe.duration > 3.3 && copyProbe.duration < 4.2, `拼接时长异常：${copyProbe.duration}`)
  console.log(`  ✓ 无损拼接完成：${copyProbe.duration.toFixed(2)}s，${copyResult.size} bytes`)

  console.log('\n[2/4] 标准化拼接（横屏 + 竖屏 + 无音轨）')
  const transcodeOutput = path.join(workDir, 'transcode.mp4')
  const transcodeResult = await runJoinJob({
    ...makeContext('transcode'),
    payload: {
      jobId: 'smoke-transcode',
      items: [{ path: landscapeA }, { path: portrait }],
      outputPath: transcodeOutput,
    },
  })
  assert(transcodeResult.mode === 'transcode', `期望 transcode 模式，实际 ${transcodeResult.mode}`)
  const transcodeProbe = await probeMedia(ffprobePath, transcodeOutput)
  assert(transcodeProbe.video.width === 640 && transcodeProbe.video.height === 360,
    `输出画布应为 640x360，实际 ${transcodeProbe.video.width}x${transcodeProbe.video.height}`)
  assert(transcodeProbe.audio, '标准化拼接应包含静音音轨')
  console.log(`  ✓ 标准化拼接完成：${transcodeProbe.video.width}x${transcodeProbe.video.height}，${transcodeProbe.duration.toFixed(2)}s`)

  const regions = [
    { x: 0.08, y: 0.08, w: 0.3, h: 0.16 },
    { x: 0.58, y: 0.68, w: 0.3, h: 0.18 },
  ]

  for (const mode of ['blur', 'mosaic', 'solid']) {
    console.log(`\n[3/4] 去水印模式：${mode}`)
    const output = path.join(workDir, `blur-${mode}.mp4`)
    const context = makeContext(mode)
    const result = await runBlurJob({
      ...context,
      payload: {
        jobId: `smoke-${mode}`,
        inputPath: landscapeA,
        outputPath: output,
        regions,
        mode,
        strength: 7,
        color: '#101820',
        quality: 'standard',
      },
    })
    const probe = await probeMedia(ffprobePath, output)
    assert(probe.video.codec === 'h264', `输出编码应为 h264，实际 ${probe.video.codec}`)
    assert(probe.video.width === 640 && probe.video.height === 360, '输出分辨率应与原片一致')
    assert(probe.audio, '输出应保留音轨')
    assert(result.size > 1000, '输出文件过小')
    console.log(`  ✓ ${mode} 完成：${result.encoderLabel || 'libx264'}，${result.size} bytes`)
  }

  console.log('\n[4/4] 全部检查通过')
}

function assert(condition, message) {
  if (condition) return
  failures += 1
  throw new Error(message)
}

main()
  .then(() => {
    console.log('\n冒烟测试通过（临时文件已清理）。')
  })
  .catch((error) => {
    failures += 1
    console.error(`\n✗ 冒烟测试失败：${error.message}`)
    console.error(`临时目录：${workDir}`)
    process.exitCode = 1
  })
  .finally(() => {
    if (failures === 0) {
      fs.rmSync(workDir, { recursive: true, force: true })
    }
  })
