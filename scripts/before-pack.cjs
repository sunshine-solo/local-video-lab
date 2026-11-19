'use strict'

/*
 * electron-builder beforePack 钩子：
 * 把“当前目标平台/架构”对应的 FFmpeg 与 FFprobe 二进制复制到 build/staged-bin，
 * 再由 electron-builder 复制到应用包的 resources/bin。
 *
 * - 本机平台直接从 node_modules 复制，不需要联网。
 * - 交叉打包（例如在 Apple Silicon 上打 Windows 包）会下载对应平台的预编译二进制，
 *   并缓存到 .cache/binaries。
 * - Windows x64 / Linux x64 的安装包建议在对应平台或 CI 上构建，避免交叉工具链问题。
 */

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const PROJECT_ROOT = path.join(__dirname, '..')
const STAGE_DIR = path.join(PROJECT_ROOT, 'build', 'staged-bin')
const CACHE_DIR = path.join(PROJECT_ROOT, '.cache', 'binaries')

const ARCH_NAMES = {
  0: 'ia32',
  1: 'x64',
  2: 'armv7l',
  3: 'arm64',
  4: 'universal',
}

// @ffprobe-installer 平台包版本，与 node_modules 中安装的版本保持一致。
const FFPROBE_VERSIONS = {
  'darwin-arm64': '5.0.1',
  'darwin-x64': '5.1.0',
  'win32-x64': '5.1.0',
  'win32-ia32': '5.1.0',
  'linux-x64': '5.2.0',
  'linux-arm64': '5.2.0',
}

const FFMPEG_ASSET_ARCH = {
  x64: 'x64',
  arm64: 'arm64',
  ia32: 'ia32',
}

const ffmpegPackage = require('ffmpeg-static/package.json')
const FFMPEG_RELEASE_TAG = ffmpegPackage['ffmpeg-static']['binary-release-tag']

async function download(url, destination, minimumBytes = 1024 * 1024) {
  if (fs.existsSync(destination)) {
    const stat = fs.statSync(destination)
    if (stat.size >= minimumBytes) return destination
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  let lastError = null

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    console.log(`  • 下载 ${path.basename(destination)}（第 ${attempt}/3 次）：${url}`)
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(600000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length < minimumBytes) {
        throw new Error(`下载内容过小（${buffer.length} bytes）`)
      }
      const temporary = `${destination}.part`
      fs.writeFileSync(temporary, buffer)
      fs.renameSync(temporary, destination)
      return destination
    } catch (error) {
      lastError = error
      console.warn(`  ! 下载失败：${error.message}`)
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
    }
  }

  throw new Error(`下载失败（已重试 3 次）：${url} — ${lastError?.message || '未知错误'}`)
}

/** 下载到内存（用于 npm tarball，体积通常比 CDN 上的原始二进制小很多）。 */
async function fetchBuffer(url, minimumBytes = 1024 * 1024) {
  let lastError = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    console.log(`  • 下载 ${url}（第 ${attempt}/3 次）`)
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(600000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length < minimumBytes) throw new Error(`下载内容过小（${buffer.length} bytes）`)
      return buffer
    } catch (error) {
      lastError = error
      console.warn(`  ! 下载失败：${error.message}`)
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
    }
  }
  throw new Error(`下载失败（已重试 3 次）：${url} — ${lastError?.message || '未知错误'}`)
}

/** 从 gzip 的 tar 包中取出单个文件（npm 平台包结构为 package/<binary>）。 */
function extractFileFromTarball(buffer, wantedName) {
  const tar = zlib.gunzipSync(buffer)
  let offset = 0
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '')
    const sizeField = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim()
    const size = Number.parseInt(sizeField, 8) || 0
    const fullName = prefix ? `${prefix}/${name}` : name
    const dataStart = offset + 512
    if (path.basename(fullName) === wantedName && size > 0) {
      return tar.subarray(dataStart, dataStart + size)
    }
    offset = dataStart + Math.ceil(size / 512) * 512
  }
  throw new Error(`tarball 中未找到 ${wantedName}`)
}

async function main(context) {
  const platform = context.electronPlatformName
  const arch = ARCH_NAMES[context.arch] || 'x64'
  if (arch === 'universal') {
    throw new Error('不支持 universal 构建，请分别构建 arm64 与 x64 安装包')
  }

  const executableSuffix = platform === 'win32' ? '.exe' : ''
  fs.rmSync(STAGE_DIR, { recursive: true, force: true })
  fs.mkdirSync(STAGE_DIR, { recursive: true })

  const ffmpegTarget = path.join(STAGE_DIR, `ffmpeg${executableSuffix}`)
  const ffprobeTarget = path.join(STAGE_DIR, `ffprobe${executableSuffix}`)
  const hostMatches = platform === process.platform && arch === process.arch

  let ffmpegSource = ''
  let ffprobeSource = ''

  if (hostMatches) {
    fs.copyFileSync(require('ffmpeg-static'), ffmpegTarget)
    fs.copyFileSync(require('@ffprobe-installer/ffprobe').path, ffprobeTarget)
    ffmpegSource = 'node_modules'
    ffprobeSource = 'node_modules'
  } else {
    const assetArch = FFMPEG_ASSET_ARCH[arch]
    if (!assetArch) throw new Error(`没有适配 ${platform}-${arch} 的 FFmpeg 二进制`)
    const ffmpegUrl = `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_RELEASE_TAG}/ffmpeg-${platform}-${assetArch}`
    const ffmpegCache = path.join(CACHE_DIR, `ffmpeg-${platform}-${assetArch}${executableSuffix}`)
    await download(ffmpegUrl, ffmpegCache)
    fs.copyFileSync(ffmpegCache, ffmpegTarget)
    ffmpegSource = ffmpegUrl

    const probeKey = `${platform}-${arch}`
    const probeVersion = FFPROBE_VERSIONS[probeKey]
    if (!probeVersion) throw new Error(`没有适配 ${probeKey} 的 FFprobe 二进制`)
    const ffprobeCache = path.join(CACHE_DIR, `ffprobe-${probeKey}${executableSuffix}`)
    if (!fs.existsSync(ffprobeCache) || fs.statSync(ffprobeCache).size < 1024 * 1024) {
      // 优先使用 npm registry 的平台包（压缩后的 tarball 比 unpkg 原始二进制更快、更稳定）。
      const tarballUrl = `https://registry.npmjs.org/@ffprobe-installer/${probeKey}/-/${probeKey}-${probeVersion}.tgz`
      try {
        const tarball = await fetchBuffer(tarballUrl)
        const binary = extractFileFromTarball(tarball, path.basename(ffprobeTarget))
        fs.writeFileSync(`${ffprobeCache}.part`, binary)
        fs.renameSync(`${ffprobeCache}.part`, ffprobeCache)
      } catch (error) {
        console.warn(`  ! npm tarball 不可用，回退到 unpkg：${error.message}`)
        const ffprobeUrl = `https://unpkg.com/@ffprobe-installer/${probeKey}@${probeVersion}/${path.basename(ffprobeTarget)}`
        await download(ffprobeUrl, ffprobeCache)
      }
    }
    fs.copyFileSync(ffprobeCache, ffprobeTarget)
    ffprobeSource = `@ffprobe-installer/${probeKey}@${probeVersion}`
  }

  if (platform !== 'win32') {
    fs.chmodSync(ffmpegTarget, 0o755)
    fs.chmodSync(ffprobeTarget, 0o755)
  }

  // 同步附带 FFmpeg 的 GPL 许可证文本。
  try {
    const licensePath = path.join(path.dirname(require.resolve('ffmpeg-static/package.json')), 'LICENSE')
    fs.copyFileSync(licensePath, path.join(STAGE_DIR, 'LICENSE-ffmpeg.txt'))
  } catch {
    // 许可证缺失不影响打包，仓库中的 THIRD_PARTY_NOTICES.md 仍有完整说明。
  }

  fs.writeFileSync(
    path.join(STAGE_DIR, 'binaries.json'),
    `${JSON.stringify({
      platform,
      arch,
      ffmpegRelease: FFMPEG_RELEASE_TAG,
      ffmpegSource,
      ffprobeSource,
      stagedAt: new Date().toISOString(),
    }, null, 2)}\n`,
    'utf8',
  )

  console.log(`  • 已准备 ${platform}-${arch} 的 FFmpeg / FFprobe 二进制`)
}

module.exports = main
