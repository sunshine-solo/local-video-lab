'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  toPixelBox,
  blurSigmaForMinSide,
  mosaicBlockForMinSide,
  buildBlurFilterGraph,
} = require('../src/main/ffmpeg/filters')

test('toPixelBox keeps coordinates even and inside the frame', () => {
  const box = toPixelBox({ x: 0.1003, y: 0.2007, w: 0.333, h: 0.222 }, 1921, 1081)
  assert.equal(box.x % 2, 0)
  assert.equal(box.y % 2, 0)
  assert.equal(box.w % 2, 0)
  assert.equal(box.h % 2, 0)
  assert.ok(box.x >= 0 && box.y >= 0)
  assert.ok(box.x + box.w <= 1921 - 1)
  assert.ok(box.y + box.h <= 1081 - 1)
})

test('toPixelBox clamps regions to at least 2px', () => {
  const box = toPixelBox({ x: 0, y: 0, w: 0.0001, h: 0.0001 }, 100, 100)
  assert.equal(box.w, 2)
  assert.equal(box.h, 2)
})

test('blur sigma grows with strength but is capped', () => {
  assert.ok(blurSigmaForMinSide(200, 8) > blurSigmaForMinSide(200, 2))
  assert.equal(blurSigmaForMinSide(100000, 10), 40)
  assert.ok(blurSigmaForMinSide(1, 1) >= 0.5)
})

test('mosaic block size grows with strength', () => {
  assert.ok(mosaicBlockForMinSide(200, 9) > mosaicBlockForMinSide(200, 2))
  assert.ok(mosaicBlockForMinSide(10, 1) >= 4)
})

test('blur graph splits input once per region and overlays in order', () => {
  const graph = buildBlurFilterGraph({
    width: 640,
    height: 360,
    regions: [
      { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      { x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
    ],
    mode: 'blur',
    strength: 6,
  })
  assert.match(graph, /^\[0:v\]split=3\[s0\]\[s1\]\[s2\]/)
  assert.match(graph, /\[s1\]crop=\d+:\d+:\d+:\d+,gblur=sigma=/)
  assert.match(graph, /\[s2\]crop=\d+:\d+:\d+:\d+,gblur=sigma=/)
  assert.match(graph, /\[s0\]\[r0\]overlay=\d+:\d+\[o0\]/)
  assert.match(graph, /\[o0\]\[r1\]overlay=\d+:\d+\[o1\]/)
  assert.match(graph, /\[o1\]format=yuv420p\[vout\]$/)
})

test('mosaic graph uses nearest-neighbour downscale and upscale', () => {
  const graph = buildBlurFilterGraph({
    width: 1280,
    height: 720,
    regions: [{ x: 0.2, y: 0.2, w: 0.3, h: 0.3 }],
    mode: 'mosaic',
    strength: 5,
  })
  assert.match(graph, /scale=\d+:\d+:flags=neighbor,scale=\d+:\d+:flags=neighbor/)
})

test('solid graph draws a filled colour box', () => {
  const graph = buildBlurFilterGraph({
    width: 640,
    height: 360,
    regions: [{ x: 0, y: 0, w: 1, h: 1 }],
    mode: 'solid',
    strength: 6,
    color: '#112233',
  })
  assert.match(graph, /drawbox=x=0:y=0:w=iw:h=ih:color=0x112233@1:t=fill/)
})

test('blur graph rejects empty regions', () => {
  assert.throws(() => buildBlurFilterGraph({
    width: 640,
    height: 360,
    regions: [],
    mode: 'blur',
    strength: 6,
  }), /至少需要一个/)
})
