'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const TEMP_PREFIX = 'local-video-lab-'

async function listJobTempDirs() {
  try {
    const entries = await fs.promises.readdir(os.tmpdir(), { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(TEMP_PREFIX))
      .map((entry) => path.join(os.tmpdir(), entry.name))
  } catch {
    return []
  }
}

/** 清理超过 24 小时的残留任务目录（应用异常退出时可能留下转码中间文件）。 */
async function cleanupStaleTempDirs(maxAgeMs = 24 * 60 * 60 * 1000) {
  const directories = await listJobTempDirs()
  const now = Date.now()
  await Promise.all(directories.map(async (directory) => {
    try {
      const stat = await fs.promises.stat(directory)
      if (now - stat.mtimeMs > maxAgeMs) {
        await fs.promises.rm(directory, { recursive: true, force: true })
      }
    } catch {
      // 目录可能已被其他进程清理。
    }
  }))
}

async function clearJobTempDirs() {
  const directories = await listJobTempDirs()
  await Promise.all(directories.map((directory) => (
    fs.promises.rm(directory, { recursive: true, force: true }).catch(() => {})
  )))
  return directories.length
}

module.exports = {
  TEMP_PREFIX,
  cleanupStaleTempDirs,
  clearJobTempDirs,
}
