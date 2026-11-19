'use strict'

/*
 * 纯函数：把用户在画面上框选的归一化区域转换成 FFmpeg filter_complex。
 * 这些函数不依赖 Electron，方便单元测试。浏览器版（cuntuweb-v2）的滤镜策略
 * 在这里保持不变：
 *   split N+1 路 -> 每路 crop 出区域 -> 区域效果 -> 依次 overlay 回原帧
 * 模糊使用高斯 sigma，马赛克使用最近邻缩小再放大，纯色直接 drawbox。
 * 预览端（renderer）使用同一组强度公式，保证所见即所得。
 */

const MAX_BLUR_SIGMA = 40

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const evenFloor = (value) => Math.max(0, Math.floor(value / 2) * 2)

/** 高斯模糊 sigma，按区域短边与强度等比计算。 */
function blurSigmaForMinSide(minSide, strength) {
  return clamp(minSide * (0.02 + strength * 0.03), 0.5, MAX_BLUR_SIGMA)
}

/** 马赛克块大小（像素），按区域短边与强度等比计算。 */
function mosaicBlockForMinSide(minSide, strength) {
  return Math.max(4, Math.round(minSide * (0.04 + strength * 0.03)))
}

/**
 * 归一化坐标 -> 像素框。坐标必须落在画面内且为偶数：yuv420p 色度抽样要求偶数
 * 宽高，奇数坐标还会让 crop / overlay 出现半像素偏移。
 */
function toPixelBox(region, width, height) {
  let x = evenFloor(clamp(Math.round(region.x * width), 0, Math.max(0, width - 2)))
  let y = evenFloor(clamp(Math.round(region.y * height), 0, Math.max(0, height - 2)))
  let w = Math.max(2, evenFloor(clamp(Math.round(region.w * width), 2, width - x)))
  let h = Math.max(2, evenFloor(clamp(Math.round(region.h * height), 2, height - y)))
  if (x + w > width) w = Math.max(2, (width - x) & ~1)
  if (y + h > height) h = Math.max(2, (height - y) & ~1)
  if (x + w > width) x = Math.max(0, width - w)
  if (y + h > height) y = Math.max(0, height - h)
  return { x, y, w, h }
}

const normalizeColor = (color) => (
  /^#[0-9a-f]{6}$/i.test(String(color || '')) ? `0x${String(color).slice(1)}@1` : '0x000000@1'
)

function mosaicSizeFor(length, shortSide, strength) {
  const block = mosaicBlockForMinSide(shortSide, strength)
  return Math.max(2, evenFloor(Math.round(length / block)))
}

/**
 * 生成区域处理滤镜图。
 * @param {{
 *   width: number,
 *   height: number,
 *   regions: Array<{x:number,y:number,w:number,h:number}>,
 *   mode: 'blur'|'mosaic'|'solid',
 *   strength: number,
 *   color?: string,
 * }} options
 */
function buildBlurFilterGraph({ width, height, regions, mode, strength, color = '#000000' }) {
  if (!Array.isArray(regions) || regions.length === 0) {
    throw new Error('至少需要一个模糊区域')
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) {
    throw new Error('视频分辨率无效')
  }

  const boxes = regions.map((region) => toPixelBox(region, width, height))
  const splitLabels = Array.from({ length: boxes.length + 1 }, (_, index) => `s${index}`)
  const parts = [`[0:v]split=${boxes.length + 1}${splitLabels.map((label) => `[${label}]`).join('')}`]
  let current = splitLabels[0]

  boxes.forEach((box, index) => {
    const chain = [`crop=${box.w}:${box.h}:${box.x}:${box.y}`]
    if (mode === 'blur') {
      chain.push(`gblur=sigma=${blurSigmaForMinSide(Math.min(box.w, box.h), strength).toFixed(2)}`)
    } else if (mode === 'mosaic') {
      const shortSide = Math.min(box.w, box.h)
      chain.push(
        `scale=${mosaicSizeFor(box.w, shortSide, strength)}:${mosaicSizeFor(box.h, shortSide, strength)}:flags=neighbor`,
        `scale=${box.w}:${box.h}:flags=neighbor`,
      )
    } else {
      chain.push(`drawbox=x=0:y=0:w=iw:h=ih:color=${normalizeColor(color)}:t=fill`)
    }
    parts.push(`[${splitLabels[index + 1]}]${chain.join(',')}[r${index}]`)
    parts.push(`[${current}][r${index}]overlay=${box.x}:${box.y}[o${index}]`)
    current = `o${index}`
  })

  const normalize = width % 2 !== 0 || height % 2 !== 0 ? 'crop=trunc(iw/2)*2:trunc(ih/2)*2,' : ''
  parts.push(`[${current}]${normalize}format=yuv420p[vout]`)
  return parts.join(';')
}

module.exports = {
  MAX_BLUR_SIGMA,
  clamp,
  evenFloor,
  blurSigmaForMinSide,
  mosaicBlockForMinSide,
  toPixelBox,
  buildBlurFilterGraph,
}
