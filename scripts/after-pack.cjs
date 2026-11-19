'use strict'

/*
 * 在 electron-builder 签名 macOS 应用之前，先给 resources/bin 里的
 * FFmpeg / FFprobe 可执行文件签名。Apple 公证要求包内所有 Mach-O 可执行文件
 * 都有有效签名；这两个二进制不在 Electron 默认的签名遍历列表里。
 *
 * 只有设置了 CSC_NAME（签名构建）时才执行；未签名构建直接跳过。
 */

const path = require('node:path')
const { spawnSync } = require('node:child_process')

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const identity = process.env.CSC_NAME
  if (!identity) return

  const appName = `${context.packager.appInfo.productFilename}.app`
  const resourcesBin = path.join(context.appOutDir, appName, 'Contents', 'Resources', 'bin')

  for (const binary of ['ffmpeg', 'ffprobe']) {
    const target = path.join(resourcesBin, binary)
    console.log(`  • 签名 ${binary}`)
    const result = spawnSync('codesign', [
      '--force',
      '--options', 'runtime',
      '--timestamp',
      '--sign', identity,
      target,
    ], { stdio: 'inherit' })
    if (result.status !== 0) {
      throw new Error(`签名失败：${target}`)
    }
  }
}
