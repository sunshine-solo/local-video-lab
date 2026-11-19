export function formatSize(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`
}

export const formatClock = formatDuration

export function formatResolution(width, height) {
  if (!width || !height) return '分辨率未知'
  return `${width} × ${height}`
}

export function formatFrameRate(fps) {
  if (!fps) return '帧率未知'
  const rounded = Math.round(Number(fps) * 100) / 100
  return `${rounded} fps`
}

export function basename(filePath = '') {
  return String(filePath).split(/[\\/]/).filter(Boolean).pop() || ''
}

export function fileStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
}

export function createId(prefix = 'job') {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  } catch {
    // 忽略，使用下方回退方案。
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function percent(value, digits = 0) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '0%'
  return `${(number * 100).toFixed(digits)}%`
}
