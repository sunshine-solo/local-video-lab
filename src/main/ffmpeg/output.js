'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

/*
 * 输出文件先写到同目录下的隐藏临时文件，成功后原子替换目标文件。
 * 这样处理失败/取消时不会破坏用户原有的同名文件，也不会留下半成品 MP4。
 */

async function assertOutputDirectory(outputPath) {
  const directory = path.dirname(outputPath)
  try {
    const stat = await fs.promises.stat(directory)
    if (!stat.isDirectory()) throw new Error('输出目录无效')
    await fs.promises.access(directory, fs.constants.W_OK)
  } catch {
    throw new Error(`输出目录不可写：${directory}`)
  }
}

function makeWorkPath(outputPath, jobId) {
  const directory = path.dirname(outputPath)
  const extension = path.extname(outputPath) || '.mp4'
  const base = path.basename(outputPath, extension)
  const safeJobId = String(jobId || 'job').replace(/[^a-z0-9-]/gi, '')
  return path.join(directory, `.${base}.partial-${safeJobId}${extension}`)
}

async function discardFile(filePath) {
  if (!filePath) return
  try {
    await fs.promises.rm(filePath, { force: true })
  } catch {
    // 文件可能已经被移动或正在被系统回收。
  }
}

async function commitOutput(workPath, outputPath) {
  try {
    // POSIX 上 rename 会原子替换目标；Windows 上目标存在时可能报 EEXIST/EPERM。
    await fs.promises.rename(workPath, outputPath)
    return
  } catch (error) {
    if (error.code === 'EXDEV') {
      await fs.promises.copyFile(workPath, outputPath)
      await discardFile(workPath)
      return
    }
    if (!['EEXIST', 'EPERM', 'EACCES'].includes(error.code)) {
      throw new Error(`无法写入输出文件：${error.message}`)
    }
  }

  // Windows：先删除旧目标再替换；目标被播放器占用时给出可操作提示。
  try {
    await fs.promises.rm(outputPath, { force: true })
  } catch {
    throw new Error('输出文件正被其他程序占用，请关闭播放器或改用其他文件名')
  }

  try {
    await fs.promises.rename(workPath, outputPath)
  } catch (error) {
    throw new Error(`无法写入输出文件：${error.message}`)
  }
}

function createTempDir(prefix = 'local-video-lab') {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), `${prefix}-`))
}

async function removeTempDir(directory) {
  if (!directory) return
  try {
    await fs.promises.rm(directory, { recursive: true, force: true })
  } catch {
    // 系统临时目录会在重启后自行清理。
  }
}

module.exports = {
  assertOutputDirectory,
  makeWorkPath,
  discardFile,
  commitOutput,
  createTempDir,
  removeTempDir,
}
