'use strict'

const { spawn } = require('node:child_process')

class FfmpegError extends Error {
  constructor(message, { stderr = '', code = null } = {}) {
    super(message)
    this.name = 'FfmpegError'
    this.stderr = stderr
    this.code = code
  }
}

class JobCancelledError extends Error {
  constructor() {
    super('已取消处理')
    this.name = 'JobCancelledError'
  }
}

/**
 * 运行一次短命令（ffprobe / ffmpeg -version / 编码器探测），带超时与输出捕获。
 */
function runCapture(command, args, { timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(command, args, { windowsHide: true })
    } catch (error) {
      reject(error)
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(new FfmpegError(`命令执行超时：${command}`, { stderr }))
    }, timeout)

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => { stdout += chunk })
    child.stderr?.on('data', (chunk) => { stderr += chunk })

    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new FfmpegError(
        error.code === 'ENOENT'
          ? `找不到可执行文件：${command}`
          : `无法启动 ${command}：${error.message}`,
      ))
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) resolve({ stdout, stderr, code })
      else reject(new FfmpegError(stderr.trim() || `${command} 退出码 ${code}`, { stderr, code }))
    })
  })
}

/**
 * 运行一次 FFmpeg 转码任务。
 * - 通过 `-progress pipe:1` 解析真实进度（0-1），而不是猜时间。
 * - stdout 用于进度，stderr 只保留最后一段，失败时作为错误信息。
 * - registerChild 让任务管理器可以在取消时终止进程。
 */
function runFfmpeg({
  ffmpegPath,
  args,
  durationSeconds = 0,
  onProgress,
  registerChild,
  isCancelled = () => false,
}) {
  return new Promise((resolve, reject) => {
    if (isCancelled()) {
      reject(new JobCancelledError())
      return
    }

    const fullArgs = [
      '-hide_banner',
      '-nostdin',
      '-loglevel', 'error',
      '-progress', 'pipe:1',
      '-nostats',
      ...args,
    ]

    let child
    try {
      child = spawn(ffmpegPath, fullArgs, { windowsHide: true })
    } catch (error) {
      reject(new FfmpegError(`无法启动 FFmpeg：${error.message}`))
      return
    }

    registerChild?.(child)
    let stderr = ''
    let stdoutBuffer = ''
    let settled = false
    let lastReported = -1

    const finish = (error, result) => {
      if (settled) return
      settled = true
      registerChild?.(null)
      if (error) reject(error)
      else resolve(result)
    }

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')

    child.stdout?.on('data', (chunk) => {
      stdoutBuffer += chunk
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop() || ''
      for (const line of lines) {
        const separator = line.indexOf('=')
        if (separator < 0) continue
        const key = line.slice(0, separator).trim()
        const value = line.slice(separator + 1).trim()
        if (key !== 'out_time_us' && key !== 'out_time_ms') continue
        if (!durationSeconds) continue
        const seconds = Number(value) / 1e6
        if (!Number.isFinite(seconds) || seconds < 0) continue
        const ratio = Math.max(0, Math.min(seconds / durationSeconds, 0.999))
        // 限制事件频率，避免高频 IPC。
        if (ratio - lastReported >= 0.002 || ratio < lastReported) {
          lastReported = ratio
          onProgress?.(ratio)
        }
      }
    })

    child.stderr?.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-16000)
    })

    child.on('error', (error) => {
      finish(new FfmpegError(
        error.code === 'ENOENT'
          ? `找不到 FFmpeg 可执行文件：${ffmpegPath}`
          : `FFmpeg 启动失败：${error.message}`,
      ))
    })

    child.on('close', (code) => {
      if (isCancelled()) {
        finish(new JobCancelledError())
        return
      }
      if (code === 0) {
        finish(null, { stderr, code })
      } else {
        const detail = stderr.trim().split('\n').slice(-12).join('\n')
        finish(new FfmpegError(
          detail || `FFmpeg 处理失败（退出码 ${code}）`,
          { stderr, code },
        ))
      }
    })
  })
}

/** 终止 FFmpeg 进程：先 SIGTERM，3 秒后仍未退出则 SIGKILL。 */
function terminateChild(child) {
  if (!child) return
  const exited = () => child.exitCode !== null || child.signalCode !== null
  if (exited()) return
  try {
    child.kill('SIGTERM')
  } catch {
    return
  }
  const timer = setTimeout(() => {
    if (exited()) return
    try {
      child.kill('SIGKILL')
    } catch {
      // 进程已退出。
    }
  }, 3000)
  timer.unref?.()
}

module.exports = {
  FfmpegError,
  JobCancelledError,
  runCapture,
  runFfmpeg,
  terminateChild,
}
