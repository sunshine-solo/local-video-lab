'use strict'

const { randomUUID } = require('node:crypto')
const { runBlurJob } = require('./ffmpeg/blurJob')
const { runJoinJob } = require('./ffmpeg/joinJob')
const { JobCancelledError, terminateChild } = require('./ffmpeg/runner')

/*
 * 任务管理器：同一时间只允许一个 FFmpeg 任务，避免多个转码把 CPU/磁盘跑满。
 * 进度通过 IPC 推送给渲染进程；取消时终止当前 FFmpeg 子进程。
 */

let activeJob = null

function isJobActive() {
  return Boolean(activeJob)
}

async function runJob(kind, payload, sender, getSettings) {
  if (activeJob) {
    return { ok: false, error: '已有任务正在处理，请先等待或取消当前任务' }
  }
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: '参数无效' }
  }

  const jobId = typeof payload.jobId === 'string' && payload.jobId
    ? payload.jobId.slice(0, 80)
    : randomUUID()
  const controller = { jobId, cancelled: false, child: null }
  activeJob = controller

  const emit = (data = {}) => {
    if (sender.isDestroyed?.()) return
    const percent = Number.isFinite(data.percent) ? Math.max(0, Math.min(100, data.percent)) : 0
    sender.send('job:progress', {
      jobId,
      phase: data.phase || 'working',
      percent: Math.round(percent * 10) / 10,
      message: data.message || '',
      detail: data.detail || '',
    })
  }

  const context = {
    payload: { ...payload, jobId },
    settings: getSettings(),
    emit,
    registerChild: (child) => { controller.child = child },
    isCancelled: () => controller.cancelled,
  }

  try {
    const result = kind === 'blur'
      ? await runBlurJob(context)
      : await runJoinJob(context)
    return { ok: true, jobId, ...result }
  } catch (error) {
    if (error instanceof JobCancelledError || controller.cancelled) {
      return { ok: false, cancelled: true, jobId, error: '已取消处理' }
    }
    console.error(`[${kind}] job failed:`, error)
    return { ok: false, jobId, error: error.message || '处理失败，请重试' }
  } finally {
    activeJob = null
  }
}

function cancelJob(jobId) {
  if (!activeJob) return { ok: false, error: '当前没有正在处理的任务' }
  if (jobId && activeJob.jobId !== jobId) {
    return { ok: false, error: '任务不匹配' }
  }
  activeJob.cancelled = true
  terminateChild(activeJob.child)
  return { ok: true }
}

function cancelActiveJob() {
  if (!activeJob) return
  activeJob.cancelled = true
  terminateChild(activeJob.child)
}

module.exports = {
  runJob,
  cancelJob,
  cancelActiveJob,
  isJobActive,
}
