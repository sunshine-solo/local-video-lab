'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  canStreamCopy,
  computeTargetSize,
  buildNormalizeFilter,
  estimateVideoBitrateKbps,
  resolveVideoBitrateKbps,
  escapeConcatPath,
  buildConcatList,
  parseFrameRate,
} = require('../src/main/ffmpeg/joinPlan')

const makeProbe = (overrides = {}) => ({
  video: {
    codec: 'h264',
    width: 1280,
    height: 720,
    pixFmt: 'yuv420p',
    fps: 30,
    rotation: 0,
    ...overrides.video,
  },
  audio: overrides.audio === null
    ? null
    : { codec: 'aac', sampleRate: 44100, channels: 2, ...overrides.audio },
})

test('parseFrameRate handles rational and numeric values', () => {
  assert.equal(parseFrameRate('30000/1001'), 29.97002997002997)
  assert.equal(parseFrameRate('25/1'), 25)
  assert.equal(parseFrameRate('0/0'), 0)
  assert.equal(parseFrameRate(24), 24)
})

test('identical H.264 probes can be stream-copied', () => {
  assert.equal(canStreamCopy([makeProbe(), makeProbe(), makeProbe()]), true)
})

test('stream copy is rejected for codec or dimension mismatch', () => {
  assert.equal(canStreamCopy([makeProbe(), makeProbe({ video: { codec: 'hevc' } })]), false)
  assert.equal(canStreamCopy([makeProbe(), makeProbe({ video: { width: 1920, height: 1080 } })]), false)
  assert.equal(canStreamCopy([makeProbe(), makeProbe({ video: { pixFmt: 'yuv444p' } })]), false)
  assert.equal(canStreamCopy([makeProbe(), makeProbe({ video: { fps: 25 } })]), false)
  assert.equal(canStreamCopy([
    makeProbe({ video: { profile: 'High' } }),
    makeProbe({ video: { profile: 'Main' } }),
  ]), false)
})

test('stream copy is rejected when audio layouts differ', () => {
  assert.equal(canStreamCopy([makeProbe(), makeProbe({ audio: null })]), false)
  assert.equal(canStreamCopy([makeProbe(), makeProbe({ audio: { sampleRate: 48000 } })]), false)
  assert.equal(canStreamCopy([makeProbe(), makeProbe({ audio: { channels: 1 } })]), false)
  assert.equal(canStreamCopy([makeProbe(), makeProbe({ audio: { codec: 'opus' } })]), false)
})

test('stream copy allows matching silent videos', () => {
  assert.equal(canStreamCopy([makeProbe({ audio: null }), makeProbe({ audio: null })]), true)
})

test('computeTargetSize caps landscape at 1280x720', () => {
  assert.deepEqual(computeTargetSize(1920, 1080), { width: 1280, height: 720 })
  assert.deepEqual(computeTargetSize(1280, 720), { width: 1280, height: 720 })
  assert.deepEqual(computeTargetSize(640, 360), { width: 640, height: 360 })
})

test('computeTargetSize caps portrait at 720x1280', () => {
  assert.deepEqual(computeTargetSize(1080, 1920), { width: 720, height: 1280 })
  assert.deepEqual(computeTargetSize(720, 1280), { width: 720, height: 1280 })
})

test('normalize filter scales, pads, normalizes sar, fps and pixel format', () => {
  const filter = buildNormalizeFilter({ width: 1280, height: 720 })
  assert.match(filter, /scale=1280:720:force_original_aspect_ratio=decrease/)
  assert.match(filter, /pad=1280:720:\(ow-iw\)\/2:\(oh-ih\)\/2:color=black/)
  assert.match(filter, /setsar=1/)
  assert.match(filter, /fps=30/)
  assert.match(filter, /format=yuv420p/)
})

test('bitrate estimate stays in a sensible range', () => {
  const value = estimateVideoBitrateKbps(1280, 720, 30)
  assert.ok(value >= 2000 && value <= 5000)
  assert.equal(estimateVideoBitrateKbps(16, 16), 400)
})

test('resolveVideoBitrateKbps prefers the video stream bitrate', () => {
  const info = { videoBitRate: 2_500_000, duration: 10, audio: { bitRate: 128_000 } }
  assert.equal(resolveVideoBitrateKbps(info, 3_000_000, 3_000_000), 2500)
  assert.equal(resolveVideoBitrateKbps({ ...info, videoBitRate: 0 }, 3_000_000, 0), 2872)
})

test('concat paths escape backslashes and single quotes', () => {
  assert.equal(escapeConcatPath("C:\\clips\\a b's.mp4"), "C:/clips/a b'\\''s.mp4")
  const list = buildConcatList(['/tmp/a.mp4', "/tmp/b's.mp4"])
  assert.equal(list, "file '/tmp/a.mp4'\nfile '/tmp/b'\\''s.mp4'\n")
})
