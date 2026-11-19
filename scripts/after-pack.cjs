'use strict'

/*
 * macOS 签名处理：
 *
 * 1. 已配置 CSC_NAME（正式签名构建）：先给 resources/bin 中的 FFmpeg / FFprobe
 *    签名，再交给 electron-builder 签名并公证。
 * 2. 未配置证书（开源默认构建）：做 ad-hoc 签名（`codesign --sign -`）。
 *    这不能替代 Apple 公证，仍然需要用户首次右键打开，但可以避免
 *    “应用已损坏 / 无法打开”的 Gatekeeper 提示。
 */

const path = require('node:path')
const { spawnSync } = require('node:child_process')

function codesign(args) {
  const result = spawnSync('codesign', args, { stdio: 'inherit' })
  return result.status === 0
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)
  const resourcesBin = path.join(appPath, 'Contents', 'Resources', 'bin')
  const identity = process.env.CSC_NAME

  if (identity) {
    for (const binary of ['ffmpeg', 'ffprobe']) {
      const target = path.join(resourcesBin, binary)
      console.log(`  • 签名 ${binary}`)
      if (!codesign(['--force', '--options', 'runtime', '--timestamp', '--sign', identity, target])) {
        throw new Error(`签名失败：${target}`)
      }
    }
    return
  }

  // 无证书：ad-hoc 签名，修复下载后“已损坏”的提示。
  console.log('  • 未配置证书，执行 ad-hoc 签名（仍建议用户首次右键打开）')
  for (const binary of ['ffmpeg', 'ffprobe']) {
    const target = path.join(resourcesBin, binary)
    if (!codesign(['--force', '--sign', '-', target])) {
      console.warn(`  ! ad-hoc 签名失败：${target}`)
    }
  }
  if (!codesign(['--force', '--deep', '--sign', '-', appPath])) {
    console.warn('  ! ad-hoc 签名应用失败，安装后可能需要手动执行 codesign 修复')
  }
}
