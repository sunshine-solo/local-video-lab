'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')

const DEFAULTS = {
  ffmpegPath: '',
  ffprobePath: '',
  hardwareAcceleration: true,
  lastOutputDir: '',
}

let cache = null

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function sanitize(patch, base) {
  const next = { ...base }
  if (typeof patch.ffmpegPath === 'string') next.ffmpegPath = patch.ffmpegPath.trim().slice(0, 4096)
  if (typeof patch.ffprobePath === 'string') next.ffprobePath = patch.ffprobePath.trim().slice(0, 4096)
  if (typeof patch.hardwareAcceleration === 'boolean') next.hardwareAcceleration = patch.hardwareAcceleration
  if (typeof patch.lastOutputDir === 'string') next.lastOutputDir = patch.lastOutputDir.trim().slice(0, 4096)
  return next
}

function load() {
  if (cache) return cache
  let stored = {}
  try {
    stored = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))
  } catch {
    stored = {}
  }
  cache = sanitize(stored && typeof stored === 'object' ? stored : {}, DEFAULTS)
  return cache
}

function getSettings() {
  return { ...load() }
}

function saveSettings(patch) {
  if (!patch || typeof patch !== 'object') return getSettings()
  const next = sanitize(patch, load())
  cache = next
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
    fs.writeFileSync(settingsFile(), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  } catch (error) {
    console.warn('保存设置失败:', error.message)
  }
  return { ...next }
}

function rememberOutputDirectory(outputPath) {
  if (!outputPath) return
  saveSettings({ lastOutputDir: path.dirname(outputPath) })
}

module.exports = {
  DEFAULTS,
  getSettings,
  saveSettings,
  rememberOutputDirectory,
  settingsFile,
}
