import { reactive } from 'vue'

export const jobState = reactive({
  jobId: '',
  active: false,
  percent: 0,
  phase: '',
  message: '',
  detail: '',
})

let initialized = false

export function initJobBridge() {
  if (initialized) return
  initialized = true
  window.api.onJobProgress((payload) => {
    if (!payload) return
    if (jobState.jobId && payload.jobId && payload.jobId !== jobState.jobId) return
    jobState.percent = Number.isFinite(payload.percent) ? payload.percent : jobState.percent
    jobState.phase = payload.phase || jobState.phase
    jobState.message = payload.message || jobState.message
    jobState.detail = payload.detail || ''
  })
}

export function beginJob(jobId) {
  jobState.jobId = jobId
  jobState.active = true
  jobState.percent = 0
  jobState.phase = 'prepare'
  jobState.message = '准备处理'
  jobState.detail = ''
}

export function endJob() {
  jobState.active = false
  jobState.jobId = ''
  jobState.percent = 0
  jobState.phase = ''
  jobState.message = ''
  jobState.detail = ''
}

export function useJob() {
  return jobState
}
