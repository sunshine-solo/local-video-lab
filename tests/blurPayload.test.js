'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { normalizeBlurPayload } = require('../src/main/ffmpeg/blurJob')

const basePayload = () => ({
  inputPath: '/tmp/input.mp4',
  outputPath: '/tmp/output.mp4',
  regions: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }],
  mode: 'blur',
  strength: 6,
  color: '#112233',
  quality: 'high',
})

test('normalizeBlurPayload accepts valid input and clamps strength', () => {
  const result = normalizeBlurPayload({ ...basePayload(), strength: 99 })
  assert.equal(result.strength, 10)
  assert.equal(result.mode, 'blur')
  assert.equal(result.quality, 'high')
  assert.equal(result.regions.length, 1)
})

test('normalizeBlurPayload rejects missing regions', () => {
  assert.throws(() => normalizeBlurPayload({ ...basePayload(), regions: [] }), /框选/)
})

test('normalizeBlurPayload rejects too many regions', () => {
  const regions = Array.from({ length: 9 }, () => ({ x: 0, y: 0, w: 0.1, h: 0.1 }))
  assert.throws(() => normalizeBlurPayload({ ...basePayload(), regions }), /最多支持/)
})

test('normalizeBlurPayload rejects non-mp4 output', () => {
  assert.throws(
    () => normalizeBlurPayload({ ...basePayload(), outputPath: '/tmp/out.mkv' }),
    /mp4/,
  )
})

test('normalizeBlurPayload rejects writing over the source file', () => {
  assert.throws(
    () => normalizeBlurPayload({ ...basePayload(), outputPath: '/tmp/input.mp4' }),
    /不能与源文件相同/,
  )
})

test('normalizeBlurPayload falls back to safe defaults for unknown enum values', () => {
  const result = normalizeBlurPayload({
    ...basePayload(),
    mode: 'unknown',
    quality: 'unknown',
    color: 'not-a-color',
  })
  assert.equal(result.mode, 'blur')
  assert.equal(result.quality, 'high')
  assert.equal(result.color, '#000000')
})
