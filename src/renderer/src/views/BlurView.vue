<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Upload,
  Sparkles,
  ScanLine,
  Play,
  Pause,
  Trash2,
  Wand2,
  Grid2x2,
  Square,
  ShieldCheck,
  FolderOpen,
  Check,
  LoaderCircle,
  CircleStop,
  RefreshCw,
  Info,
  FileVideo,
  Monitor,
  Clock,
  Zap,
} from '@lucide/vue'
import PageHeader from '@/components/PageHeader.vue'
import ProgressBar from '@/components/ProgressBar.vue'
import { useJob, beginJob, endJob } from '@/composables/useJob'
import { toast } from '@/composables/useToast'
import { confirm } from '@/composables/useConfirm'
import { useEngine } from '@/composables/useEngine'
import { useSettings } from '@/composables/useSettings'
import {
  basename,
  createId,
  fileStamp,
  formatClock,
  formatResolution,
  formatSize,
  percent,
} from '@/utils/format'

const MAX_REGIONS = 8
const MIN_REGION_PX = 14
const MAX_BLUR_SIGMA = 40
const LARGE_FILE_BYTES = 2 * 1024 * 1024 * 1024
const HANDLES = ['nw', 'ne', 'sw', 'se']

const MODES = [
  { value: 'blur', label: '模糊', icon: Wand2, hint: '柔化水印边缘，画面观感最自然' },
  { value: 'mosaic', label: '马赛克', icon: Grid2x2, hint: '像素块覆盖，遮盖更彻底、更“打码”' },
  { value: 'solid', label: '纯色', icon: Square, hint: '用纯色块完全遮挡，适合大面积水印' },
]

const QUALITY_OPTIONS = [
  { value: 'high', label: '精细', desc: 'veryfast + CRF 20，画质优先' },
  { value: 'standard', label: '标准', desc: 'ultrafast + CRF 23，速度优先' },
]

const { engine } = useEngine()
const { settings, updateSettings } = useSettings()
const job = useJob()

const videoPath = ref('')
const videoInfo = ref(null)
const videoRef = ref(null)
const stageRef = ref(null)
const canvasRef = ref(null)
const loadingFile = ref(false)
const isDragging = ref(false)
const dragDepth = ref(0)
const previewError = ref(false)
const previewWarning = ref('')
const useCors = ref(true)

const duration = ref(0)
const currentTime = ref(0)
const isPlaying = ref(false)
const displayAspect = ref(16 / 9)
const fps = ref(30)

const regions = ref([])
const selectedId = ref(null)
const mode = ref('blur')
const strength = ref(6)
const solidColor = ref('#000000')
const quality = ref('high')

const processing = ref(false)
const cancelling = ref(false)
const result = ref(null)
const currentJobId = ref('')

let nextRegionId = 1
let dragState = null
let previewFrameId = 0
let scratchCanvas = null
let lastPreviewAt = 0
let resizeObserver = null
let resizeFrameId = 0

const videoUrl = computed(() => (videoPath.value ? window.api.toMediaUrl(videoPath.value) : ''))
const mediaUrl = (filePath) => window.api.toMediaUrl(filePath)
const activeMode = computed(() => MODES.find((item) => item.value === mode.value) || MODES[0])
const canProcess = computed(() => (
  Boolean(videoPath.value) && regions.value.length > 0 && !processing.value && !loadingFile.value
))
const stageStyle = computed(() => ({
  aspectRatio: String(displayAspect.value),
  maxWidth: `calc(540px * ${displayAspect.value})`,
}))
const timelineFill = computed(() => (
  duration.value > 0 ? `${Math.min(100, (currentTime.value / duration.value) * 100)}%` : '0%'
))
const strengthFill = computed(() => `${((Number(strength.value) - 1) / 9) * 100}%`)
const summaryText = computed(() => {
  const size = videoInfo.value
    ? ` · ${videoInfo.value.video.width} × ${videoInfo.value.video.height}`
    : ''
  return `${regions.value.length} 个区域 · ${activeMode.value.label}${size}`
})
const hardwareEnabled = computed(() => settings.hardwareAcceleration !== false)
const encoderLabel = computed(() => {
  if (!engine.info?.ffmpegVersion) {
    return engine.loading ? '正在检测编码引擎' : '编码引擎未就绪'
  }
  if (!hardwareEnabled.value) return 'libx264 软件编码'
  if (engine.info.hardwareEncoder) {
    return `${engine.info.hardwareEncoderLabel || engine.info.hardwareEncoder} 硬件加速`
  }
  return 'libx264（未检测到硬件编码器）'
})
const resultModeLabel = computed(() => {
  if (!result.value) return ''
  return result.value.encoder ? `${result.value.encoderLabel} 硬件编码` : 'libx264 软件编码'
})

const supportsCanvasFilter = (() => {
  try {
    const context = document.createElement('canvas').getContext('2d')
    return Boolean(context && 'filter' in context)
  } catch {
    return false
  }
})()

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const blurSigmaForMinSide = (minSide) => clamp(
  minSide * (0.02 + Number(strength.value) * 0.03),
  0.5,
  MAX_BLUR_SIGMA,
)
const mosaicBlockForMinSide = (minSide) => Math.max(
  4,
  Math.round(minSide * (0.04 + Number(strength.value) * 0.03)),
)

/* ------------------------------ 预览渲染 ------------------------------ */

function drawScaled(ctx, video, source, target, smallWidth, smallHeight, smooth) {
  if (!scratchCanvas) scratchCanvas = document.createElement('canvas')
  if (scratchCanvas.width !== smallWidth || scratchCanvas.height !== smallHeight) {
    scratchCanvas.width = smallWidth
    scratchCanvas.height = smallHeight
  }
  const scratchCtx = scratchCanvas.getContext('2d')
  scratchCtx.imageSmoothingEnabled = true
  scratchCtx.clearRect(0, 0, smallWidth, smallHeight)
  scratchCtx.drawImage(video, source.x, source.y, source.w, source.h, 0, 0, smallWidth, smallHeight)
  const previousSmoothing = ctx.imageSmoothingEnabled
  ctx.imageSmoothingEnabled = smooth
  ctx.drawImage(scratchCanvas, 0, 0, smallWidth, smallHeight, target.x, target.y, target.w, target.h)
  ctx.imageSmoothingEnabled = previousSmoothing
}

function drawPreview() {
  const video = videoRef.value
  const canvas = canvasRef.value
  const stage = stageRef.value
  if (!video || !canvas || !stage || !video.videoWidth || !video.videoHeight) return
  if (video.readyState < 2) return

  const cssWidth = stage.clientWidth
  const cssHeight = stage.clientHeight
  if (!cssWidth || !cssHeight) return

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const width = Math.max(1, Math.round(cssWidth * dpr))
  const height = Math.max(1, Math.round(cssHeight * dpr))
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.imageSmoothingEnabled = true

  try {
    ctx.drawImage(video, 0, 0, width, height)
  } catch {
    previewWarning.value = '预览受浏览器安全策略限制，画面无法绘制，但处理功能仍然可用'
    return
  }

  for (const region of regions.value) {
    const target = {
      x: region.x * width,
      y: region.y * height,
      w: region.w * width,
      h: region.h * height,
    }
    if (target.w < 2 || target.h < 2) continue

    const source = {
      x: region.x * video.videoWidth,
      y: region.y * video.videoHeight,
      w: region.w * video.videoWidth,
      h: region.h * video.videoHeight,
    }
    const minSide = Math.min(target.w, target.h)

    ctx.save()
    ctx.beginPath()
    ctx.rect(target.x, target.y, target.w, target.h)
    ctx.clip()

    if (mode.value === 'solid') {
      ctx.fillStyle = solidColor.value
      ctx.fillRect(target.x, target.y, target.w, target.h)
    } else if (mode.value === 'mosaic') {
      const block = mosaicBlockForMinSide(minSide)
      const smallWidth = Math.max(1, Math.round(target.w / block))
      const smallHeight = Math.max(1, Math.round(target.h / block))
      drawScaled(ctx, video, source, target, smallWidth, smallHeight, false)
    } else {
      const sigma = blurSigmaForMinSide(minSide)
      if (supportsCanvasFilter) {
        ctx.filter = `blur(${sigma}px)`
        ctx.drawImage(video, 0, 0, width, height)
        ctx.filter = 'none'
      } else {
        const division = Math.max(2, Math.round(sigma * 2))
        const smallWidth = Math.max(1, Math.round(target.w / division))
        const smallHeight = Math.max(1, Math.round(target.h / division))
        drawScaled(ctx, video, source, target, smallWidth, smallHeight, true)
      }
    }

    ctx.restore()
  }
  lastPreviewAt = performance.now()
}

function startPreviewLoop() {
  stopPreviewLoop()
  const tick = () => {
    const video = videoRef.value
    if (!video || video.paused) {
      previewFrameId = 0
      return
    }
    if (performance.now() - lastPreviewAt >= 30) drawPreview()
    previewFrameId = requestAnimationFrame(tick)
  }
  previewFrameId = requestAnimationFrame(tick)
}

function stopPreviewLoop() {
  if (previewFrameId) cancelAnimationFrame(previewFrameId)
  previewFrameId = 0
}

/* ------------------------------ 视频播放 ------------------------------ */

function onMetadata() {
  const video = videoRef.value
  if (!video) return
  if (Number.isFinite(video.duration) && video.duration > 0) duration.value = video.duration
  currentTime.value = video.currentTime || 0
  if (video.videoWidth && video.videoHeight) {
    displayAspect.value = video.videoWidth / video.videoHeight
    if (videoInfo.value) {
      videoInfo.value.video.width = video.videoWidth
      videoInfo.value.video.height = video.videoHeight
    }
  }
  nextTick(drawPreview)
}

function onVideoError() {
  if (useCors.value) {
    useCors.value = false
    previewWarning.value = '已切换兼容预览模式，若画面空白可直接开始处理'
    nextTick(() => videoRef.value?.load())
    return
  }
  previewError.value = true
  previewWarning.value = ''
  toast.error('该视频无法在预览器中播放，编码格式可能不受支持；仍可尝试处理')
}

function onPlay() {
  isPlaying.value = true
  startPreviewLoop()
}

function onPause() {
  isPlaying.value = false
  stopPreviewLoop()
  drawPreview()
}

function onTimeUpdate() {
  const video = videoRef.value
  if (!video || dragState) return
  currentTime.value = video.currentTime
}

async function togglePlay() {
  const video = videoRef.value
  if (!video || processing.value) return
  if (video.paused) {
    try {
      await video.play()
    } catch {
      toast.warning('无法开始播放，请再点一次播放按钮')
    }
  } else {
    video.pause()
  }
}

function onSeek(event) {
  const video = videoRef.value
  if (!video) return
  const value = Number(event.target.value)
  currentTime.value = value
  try {
    video.currentTime = value
  } catch {
    // 元数据尚未加载完成时忽略。
  }
  requestAnimationFrame(drawPreview)
}

function stepFrame(direction) {
  const video = videoRef.value
  if (!video || !duration.value) return
  const frame = 1 / (Number(fps.value) || 30)
  const next = clamp(video.currentTime + direction * frame, 0, duration.value)
  video.currentTime = next
  currentTime.value = next
  requestAnimationFrame(drawPreview)
}

/* ------------------------------ 文件选择 ------------------------------ */

async function loadVideo(filePath) {
  if (!filePath || processing.value) return
  loadingFile.value = true
  const response = await window.api.probe(filePath)
  if (!response?.ok) {
    loadingFile.value = false
    toast.error(response?.error || '无法读取该视频')
    return
  }

  const info = response.info
  const oldVideo = videoRef.value
  if (oldVideo) oldVideo.pause()
  stopPreviewLoop()

  videoPath.value = filePath
  videoInfo.value = info
  duration.value = info.duration || 0
  currentTime.value = 0
  displayAspect.value = info.video.width && info.video.height
    ? info.video.width / info.video.height
    : 16 / 9
  fps.value = Math.round(info.video.fps) || 30
  regions.value = []
  selectedId.value = null
  result.value = null
  previewError.value = false
  previewWarning.value = ''
  useCors.value = true
  isPlaying.value = false
  loadingFile.value = false

  if (info.size > LARGE_FILE_BYTES) {
    toast.warning('视频超过 2GB，处理时间可能较长；建议接通电源并避免电脑睡眠')
  }
  await nextTick()
  videoRef.value?.load?.()
}

async function pickVideo() {
  if (processing.value) return
  const response = await window.api.selectVideos()
  if (!response?.paths?.length) return
  if (response.paths.length > 1) toast.info('一次处理一个视频，已选择第一个')
  loadVideo(response.paths[0])
}

function onDragEnter() {
  if (processing.value) return
  dragDepth.value += 1
  isDragging.value = true
}

function onDragLeave() {
  dragDepth.value = Math.max(0, dragDepth.value - 1)
  if (dragDepth.value === 0) isDragging.value = false
}

function onDrop(event) {
  dragDepth.value = 0
  isDragging.value = false
  if (processing.value) return
  const file = event.dataTransfer?.files?.[0]
  if (!file) return
  let filePath = ''
  try {
    filePath = window.api.getPathForFile(file)
  } catch {
    filePath = ''
  }
  if (!filePath) {
    toast.warning('未能读取文件路径，请使用“选择本地视频”按钮')
    return
  }
  loadVideo(filePath)
}

async function resetVideo() {
  if (processing.value) return
  if (regions.value.length) {
    const agreed = await confirm({
      title: '更换视频？',
      message: '当前框选的区域会被清除，已生成的结果不受影响。',
      confirmText: '更换视频',
    })
    if (!agreed) return
  }
  const video = videoRef.value
  video?.pause()
  stopPreviewLoop()
  videoPath.value = ''
  videoInfo.value = null
  regions.value = []
  selectedId.value = null
  duration.value = 0
  currentTime.value = 0
  isPlaying.value = false
  previewError.value = false
  previewWarning.value = ''
  result.value = null
}

/* ------------------------------ 区域编辑 ------------------------------ */

function regionStyle(region) {
  return {
    left: `${region.x * 100}%`,
    top: `${region.y * 100}%`,
    width: `${region.w * 100}%`,
    height: `${region.h * 100}%`,
  }
}

const regionIndex = (region) => regions.value.findIndex((item) => item.id === region.id) + 1

function pointerPoint(event) {
  const rect = stageRef.value?.getBoundingClientRect()
  if (!rect || !rect.width || !rect.height) return { x: 0, y: 0 }
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
  }
}

function minRegionSize() {
  const rect = stageRef.value?.getBoundingClientRect()
  return {
    width: MIN_REGION_PX / (rect?.width || 1),
    height: MIN_REGION_PX / (rect?.height || 1),
  }
}

function onWindowPointerMove(event) {
  if (!dragState) return
  const region = regions.value.find((item) => item.id === dragState.id)
  if (!region) return
  const point = pointerPoint(event)
  const minimum = minRegionSize()

  if (dragState.type === 'new') {
    const origin = dragState.origin
    region.x = Math.min(origin.x, point.x)
    region.y = Math.min(origin.y, point.y)
    region.w = Math.abs(point.x - origin.x)
    region.h = Math.abs(point.y - origin.y)
    return
  }

  if (dragState.type === 'move') {
    const origin = dragState.origin
    const box = dragState.box
    region.x = clamp(box.x + (point.x - origin.x), 0, 1 - box.w)
    region.y = clamp(box.y + (point.y - origin.y), 0, 1 - box.h)
    return
  }

  const box = dragState.box
  let left = box.x
  let top = box.y
  let right = box.x + box.w
  let bottom = box.y + box.h
  const handle = dragState.handle

  if (handle.includes('w')) left = Math.min(point.x, right - minimum.width)
  if (handle.includes('e')) right = Math.max(point.x, left + minimum.width)
  if (handle.includes('n')) top = Math.min(point.y, bottom - minimum.height)
  if (handle.includes('s')) bottom = Math.max(point.y, top + minimum.height)

  left = clamp(left, 0, 1)
  top = clamp(top, 0, 1)
  right = clamp(right, 0, 1)
  bottom = clamp(bottom, 0, 1)
  region.x = left
  region.y = top
  region.w = Math.max(minimum.width, right - left)
  region.h = Math.max(minimum.height, bottom - top)
}

function onWindowPointerUp() {
  if (dragState?.type === 'new') {
    const region = regions.value.find((item) => item.id === dragState.id)
    if (region) {
      const minimum = minRegionSize()
      if (region.w < minimum.width || region.h < minimum.height) {
        regions.value = regions.value.filter((item) => item.id !== region.id)
        if (selectedId.value === region.id) selectedId.value = null
      }
    }
  }
  dragState = null
  detachDragListeners()
  drawPreview()
}

function attachDragListeners() {
  window.addEventListener('pointermove', onWindowPointerMove)
  window.addEventListener('pointerup', onWindowPointerUp)
  window.addEventListener('pointercancel', onWindowPointerUp)
}

function detachDragListeners() {
  window.removeEventListener('pointermove', onWindowPointerMove)
  window.removeEventListener('pointerup', onWindowPointerUp)
  window.removeEventListener('pointercancel', onWindowPointerUp)
}

function onStagePointerDown(event) {
  if (event.button !== 0 || processing.value) return
  if (regions.value.length >= MAX_REGIONS) {
    toast.warning(`最多框选 ${MAX_REGIONS} 个区域`)
    return
  }
  const point = pointerPoint(event)
  const id = nextRegionId++
  regions.value.push({ id, x: point.x, y: point.y, w: 0, h: 0 })
  selectedId.value = id
  dragState = { type: 'new', id, origin: point }
  attachDragListeners()
  event.preventDefault()
}

function onRegionPointerDown(event, region) {
  if (event.button !== 0 || processing.value) return
  selectedId.value = region.id
  dragState = {
    type: 'move',
    id: region.id,
    origin: pointerPoint(event),
    box: { x: region.x, y: region.y, w: region.w, h: region.h },
  }
  attachDragListeners()
  event.preventDefault()
}

function onHandlePointerDown(event, region, handle) {
  if (event.button !== 0 || processing.value) return
  selectedId.value = region.id
  dragState = {
    type: 'resize',
    id: region.id,
    handle,
    box: { x: region.x, y: region.y, w: region.w, h: region.h },
  }
  attachDragListeners()
  event.preventDefault()
}

function removeRegion(id) {
  regions.value = regions.value.filter((item) => item.id !== id)
  if (selectedId.value === id) selectedId.value = null
  drawPreview()
}

function clearRegions() {
  regions.value = []
  selectedId.value = null
  drawPreview()
}

/* ------------------------------ 处理任务 ------------------------------ */

async function processVideo() {
  if (!canProcess.value) return
  const output = await window.api.selectOutput({
    fileName: `视频去水印_${fileStamp()}.mp4`,
    title: '保存处理结果',
  })
  if (!output?.ok) return

  videoRef.value?.pause()
  processing.value = true
  cancelling.value = false
  result.value = null
  const jobId = createId('blur')
  currentJobId.value = jobId
  beginJob(jobId)

  try {
    const response = await window.api.startBlur({
      jobId,
      inputPath: videoPath.value,
      outputPath: output.path,
      regions: regions.value.map(({ x, y, w, h }) => ({ x, y, w, h })),
      mode: mode.value,
      strength: strength.value,
      color: solidColor.value,
      quality: quality.value,
    })
    if (response?.ok) {
      result.value = response
      toast.success('视频处理完成')
    } else if (response?.cancelled) {
      toast.info('已取消处理')
    } else {
      toast.error(response?.error || '视频处理失败，请重试')
    }
  } catch (error) {
    toast.error(error?.message || '视频处理失败，请重试')
  } finally {
    processing.value = false
    cancelling.value = false
    currentJobId.value = ''
    endJob()
  }
}

async function cancelProcessing() {
  if (!processing.value || cancelling.value) return
  cancelling.value = true
  await window.api.cancelJob(currentJobId.value)
}

async function toggleHardware() {
  const next = !hardwareEnabled.value
  await updateSettings({ hardwareAcceleration: next })
  toast.success(next ? '已启用硬件加速，下次任务生效' : '已切换为软件编码，下次任务生效')
}

function revealResult() {
  if (result.value?.outputPath) window.api.revealFile(result.value.outputPath)
}

function openResult() {
  if (result.value?.outputPath) window.api.openPath(result.value.outputPath)
}

function resetResult() {
  result.value = null
}

/* ------------------------------ 生命周期 ------------------------------ */

function onWindowResize() {
  if (resizeFrameId) return
  resizeFrameId = requestAnimationFrame(() => {
    resizeFrameId = 0
    drawPreview()
  })
}

watch([regions, mode, strength, solidColor, quality], () => drawPreview(), { deep: true })

watch(stageRef, (element, previous) => {
  if (previous) resizeObserver?.unobserve(previous)
  if (element) resizeObserver?.observe(element)
})

onMounted(() => {
  resizeObserver = new ResizeObserver(() => drawPreview())
  if (stageRef.value) resizeObserver.observe(stageRef.value)
  window.addEventListener('resize', onWindowResize)
})

onBeforeUnmount(() => {
  stopPreviewLoop()
  detachDragListeners()
  window.removeEventListener('resize', onWindowResize)
  resizeObserver?.disconnect()
  if (resizeFrameId) cancelAnimationFrame(resizeFrameId)
  videoRef.value?.pause()
})
</script>

<template>
  <div class="page">
    <PageHeader
      title="视频去水印"
      subtitle="框选画面中的水印区域，一键模糊整段视频。预览与导出使用同一套参数，处理全程在本机完成。"
    >
      <template #actions>
        <span v-if="videoInfo" class="pill">
          <Monitor :size="13" />
          {{ formatResolution(videoInfo.video.width, videoInfo.video.height) }}
        </span>
      </template>
    </PageHeader>

    <section v-if="!videoPath" class="card upload-card">
      <div class="upload-layout">
        <button
          class="upload-zone"
          type="button"
          data-testid="blur-upload"
          :class="{ dragging: isDragging }"
          :disabled="loadingFile"
          @click="pickVideo"
          @dragenter.prevent="onDragEnter"
          @dragover.prevent
          @dragleave.prevent="onDragLeave"
          @drop.prevent="onDrop"
        >
          <span class="upload-icon">
            <LoaderCircle v-if="loadingFile" :size="26" class="spin" />
            <Upload v-else :size="26" />
          </span>
          <strong>{{ loadingFile ? '正在读取视频信息…' : '选择本地视频' }}</strong>
          <span class="upload-hint">也可以把视频拖到这里</span>
          <span class="upload-formats">MP4 / MOV / WebM / MKV / AVI</span>
          <span class="upload-privacy"><ShieldCheck :size="12" /> 文件不会上传</span>
        </button>

        <div class="upload-guide">
          <div class="guide-title">
            <Sparkles :size="16" />
            <span>三步完成去水印</span>
          </div>
          <ol class="guide-steps">
            <li>
              <span class="guide-index">01</span>
              <div><b>定位画面</b><p>拖动进度条，停在水印最清晰的一帧。</p></div>
            </li>
            <li>
              <span class="guide-index">02</span>
              <div><b>框选区域</b><p>在画面上拖拽框选，最多可添加 8 个区域。</p></div>
            </li>
            <li>
              <span class="guide-index">03</span>
              <div><b>选择遮挡并处理</b><p>模糊、马赛克或纯色，导出为 H.264 MP4。</p></div>
            </li>
          </ol>
          <div class="guide-note">
            <Zap :size="13" />
            <span>桌面版直接调用原生 FFmpeg，速度远快于网页端。</span>
          </div>
        </div>
      </div>
    </section>

    <template v-else>
      <div class="blur-grid">
        <section class="card stage-card">
          <div class="stage-head">
            <div class="stage-file">
              <FileVideo :size="15" />
              <span :title="videoInfo?.name">{{ videoInfo?.name || basename(videoPath) }}</span>
            </div>
            <div class="stage-actions">
              <span class="pill">
                <Clock :size="12" />
                {{ formatClock(duration) }}
              </span>
              <button class="btn btn-ghost btn-sm" type="button" :disabled="processing" @click="resetVideo">
                <Upload :size="13" />
                更换视频
              </button>
            </div>
          </div>

          <div
            ref="stageRef"
            class="stage"
            data-testid="blur-stage"
            :style="stageStyle"
            @pointerdown="onStagePointerDown"
          >
            <video
              ref="videoRef"
              class="stage-video"
              :src="videoUrl"
              :crossorigin="useCors ? 'anonymous' : undefined"
              playsinline
              muted
              preload="auto"
              draggable="false"
              @dragstart.prevent
              @loadedmetadata="onMetadata"
              @loadeddata="drawPreview"
              @seeked="drawPreview"
              @play="onPlay"
              @pause="onPause"
              @timeupdate="onTimeUpdate"
              @error="onVideoError"
            ></video>
            <canvas ref="canvasRef" class="stage-canvas"></canvas>

            <div
              v-for="region in regions"
              :key="region.id"
              class="region"
              :class="{ selected: region.id === selectedId }"
              :style="regionStyle(region)"
              @pointerdown.stop="onRegionPointerDown($event, region)"
            >
              <span class="region-tag">{{ regionIndex(region) }}</span>
              <template v-if="region.id === selectedId">
                <span
                  v-for="handle in HANDLES"
                  :key="handle"
                  class="region-handle"
                  :class="handle"
                  @pointerdown.stop="onHandlePointerDown($event, region, handle)"
                ></span>
              </template>
            </div>

            <div v-if="!regions.length" class="stage-hint">
              <ScanLine :size="20" />
              <span>在画面上拖拽，框选要模糊的区域</span>
            </div>

            <div v-if="previewError" class="stage-error">
              <FileVideo :size="20" />
              <span>预览不可用，仍可尝试处理</span>
            </div>
          </div>

          <div class="scrubber">
            <button class="btn btn-icon btn-secondary" type="button" title="播放 / 暂停" :disabled="processing || previewError" @click="togglePlay">
              <Pause v-if="isPlaying" :size="15" />
              <Play v-else :size="15" />
            </button>
            <span class="time mono">{{ formatClock(currentTime) }}</span>
            <input
              class="slider timeline"
              type="range"
              min="0"
              :max="duration || 0"
              step="0.02"
              :value="currentTime"
              :disabled="!duration || processing"
              :style="{ '--fill': timelineFill }"
              @input="onSeek"
            />
            <span class="time mono">{{ formatClock(duration) }}</span>
            <div class="frame-buttons">
              <button class="btn btn-ghost btn-sm" type="button" :disabled="processing" @click="stepFrame(-1)">−1 帧</button>
              <button class="btn btn-ghost btn-sm" type="button" :disabled="processing" @click="stepFrame(1)">+1 帧</button>
            </div>
          </div>

          <p class="stage-note">
            <Info :size="13" />
            框选后可拖动区域整体移动，拖四角控制点调整大小；按区域短边自动匹配遮挡强度。
          </p>
          <p v-if="previewWarning" class="stage-warning">{{ previewWarning }}</p>
        </section>

        <aside class="card settings-card">
          <div class="settings-head">
            <div class="step-title">
              <span class="step">02</span>
              <h3>遮挡设置</h3>
            </div>
            <span class="area-count">{{ regions.length }} / {{ MAX_REGIONS }}</span>
          </div>

          <div class="field">
            <label class="field-label">遮挡方式</label>
            <div class="mode-cards">
              <button
                v-for="item in MODES"
                :key="item.value"
                class="mode-card"
                :class="{ active: mode === item.value }"
                type="button"
                :disabled="processing"
                @click="mode = item.value"
              >
                <component :is="item.icon" :size="16" />
                <span>{{ item.label }}</span>
              </button>
            </div>
            <p class="field-hint">{{ activeMode.hint }}</p>
          </div>

          <div v-if="mode !== 'solid'" class="field">
            <label class="field-label">
              遮挡强度
              <b>{{ strength }}</b>
            </label>
            <input
              v-model.number="strength"
              class="slider"
              type="range"
              min="1"
              max="10"
              step="1"
              :style="{ '--fill': strengthFill }"
              :disabled="processing"
            />
            <div class="range-scale"><span>轻</span><span>自然</span><span>强</span></div>
          </div>

          <div v-else class="field">
            <label class="field-label">遮挡颜色</label>
            <div class="color-row">
              <input v-model="solidColor" class="color-input" type="color" :disabled="processing" />
              <span class="color-value mono">{{ solidColor.toUpperCase() }}</span>
            </div>
          </div>

          <div class="field">
            <label class="field-label">输出质量</label>
            <div class="quality-list">
              <button
                v-for="item in QUALITY_OPTIONS"
                :key="item.value"
                class="quality-option"
                :class="{ active: quality === item.value }"
                type="button"
                :disabled="processing"
                @click="quality = item.value"
              >
                <span class="radio"></span>
                <span class="quality-copy">
                  <b>{{ item.label }}</b>
                  <span>{{ item.desc }}</span>
                </span>
              </button>
            </div>
            <p class="field-hint">源视频码率已知时会优先对齐原片，避免重新编码后体积变大。</p>
          </div>

          <div class="field">
            <label class="field-label">编码引擎</label>
            <div class="engine-row">
              <div class="engine-copy">
                <b>{{ encoderLabel }}</b>
                <span>{{ hardwareEnabled ? '优先使用 GPU / 媒体引擎，失败自动回退' : '使用 CPU 软件编码' }}</span>
              </div>
              <button
                class="switch"
                :class="{ on: hardwareEnabled }"
                type="button"
                role="switch"
                :aria-checked="hardwareEnabled"
                :disabled="processing"
                @click="toggleHardware"
              ></button>
            </div>
          </div>

          <div class="field regions-field">
            <label class="field-label">
              已框选区域
              <span>{{ regions.length }}</span>
            </label>
            <p v-if="!regions.length" class="empty-regions">
              还没有区域，请在左侧画面上拖拽框选。
            </p>
            <div v-else class="region-list">
              <button
                v-for="(region, index) in regions"
                :key="region.id"
                class="region-row"
                data-testid="region-row"
                :class="{ selected: selectedId === region.id }"
                type="button"
                @click="selectedId = region.id"
              >
                <span class="region-number">{{ index + 1 }}</span>
                <span class="region-meta">
                  {{ percent(region.w) }} × {{ percent(region.h) }}
                  <i>位置 {{ percent(region.x) }}, {{ percent(region.y) }}</i>
                </span>
                <span
                  class="region-remove"
                  role="button"
                  tabindex="0"
                  title="删除区域"
                  @click.stop="removeRegion(region.id)"
                  @keydown.enter.stop="removeRegion(region.id)"
                >
                  <Trash2 :size="13" />
                </span>
              </button>
              <button class="btn btn-ghost btn-sm clear-regions" type="button" :disabled="processing" @click="clearRegions">
                清空全部区域
              </button>
            </div>
          </div>
        </aside>
      </div>

      <section class="card output-card">
        <div class="output-head">
          <div class="step-title">
            <span class="step">03</span>
            <h3>生成并下载</h3>
          </div>
          <span v-if="regions.length" class="output-summary">{{ summaryText }}</span>
        </div>

        <div v-if="processing" class="progress-block" data-testid="blur-progress">
          <div class="progress-head">
            <div class="progress-copy">
              <strong>{{ job.message || '正在处理' }}</strong>
              <span>{{ job.detail || '正在准备 FFmpeg 任务' }}</span>
            </div>
            <b>{{ Math.round(job.percent) }}%</b>
          </div>
          <ProgressBar :value="job.percent" />
          <div class="progress-actions">
            <button class="btn btn-ghost btn-sm" type="button" :disabled="cancelling" @click="cancelProcessing">
              <CircleStop :size="14" />
              {{ cancelling ? '正在取消…' : '取消处理' }}
            </button>
          </div>
        </div>

        <div v-else-if="result" class="result-block" data-testid="blur-result">
          <div class="result-preview">
            <video :src="mediaUrl(result.outputPath)" controls playsinline></video>
          </div>
          <div class="result-info">
            <div class="success-badge"><Check :size="17" /></div>
            <div class="result-copy">
              <strong>处理完成</strong>
              <span>
                {{ formatSize(result.size) }}（原片 {{ videoInfo ? formatSize(videoInfo.size) : '—' }}）
                · {{ formatResolution(result.width, result.height) }} · {{ resultModeLabel }}
              </span>
              <code :title="result.outputPath">{{ result.outputPath }}</code>
            </div>
            <div class="result-actions">
              <button class="btn btn-primary" type="button" @click="revealResult">
                <FolderOpen :size="15" />
                在文件夹中显示
              </button>
              <button class="btn btn-secondary" type="button" @click="openResult">
                <Play :size="15" />
                播放
              </button>
              <button class="btn btn-ghost" type="button" @click="resetResult">
                <RefreshCw :size="15" />
                调整后重新处理
              </button>
            </div>
          </div>
        </div>

        <div v-else class="generate-row">
          <div class="generate-copy">
            <strong>{{ canProcess ? '区域已就绪，可以开始处理' : '请先在画面上框选至少一个区域' }}</strong>
            <span>保持原视频分辨率与帧率，输出 H.264 MP4；首次处理会自动检测可用的硬件编码器。</span>
          </div>
          <button class="btn btn-primary btn-lg" type="button" data-testid="blur-process" :disabled="!canProcess" @click="processVideo">
            <Sparkles :size="17" />
            一键处理
          </button>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.upload-card {
  padding: 26px;
}

.upload-layout {
  display: grid;
  grid-template-columns: minmax(320px, 1fr) minmax(320px, 0.9fr);
  gap: 26px;
  align-items: stretch;
}

.upload-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 310px;
  padding: 28px;
  border: 1.5px dashed var(--border-2);
  border-radius: 15px;
  background:
    radial-gradient(320px 180px at 50% 0%, var(--accent-soft), transparent 70%),
    var(--surface-2);
  color: var(--text);
  text-align: center;
  transition: border-color 0.16s ease, background 0.16s ease;
}

.upload-zone:not(:disabled):hover,
.upload-zone.dragging {
  border-color: var(--accent);
  background:
    radial-gradient(320px 180px at 50% 0%, var(--accent-soft-2), transparent 70%),
    var(--accent-soft);
}

.upload-zone:disabled {
  cursor: wait;
}

.upload-icon {
  width: 58px;
  height: 58px;
  display: grid;
  place-items: center;
  margin-bottom: 8px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
  color: var(--accent);
  box-shadow: var(--shadow-card);
}

.upload-zone strong {
  font-size: 16px;
  font-weight: 700;
}

.upload-hint {
  color: var(--text-2);
  font-size: 12.5px;
}

.upload-formats {
  margin-top: 8px;
  color: var(--text-3);
  font-size: 10.5px;
  letter-spacing: 0.06em;
}

.upload-privacy {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 16px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-3);
  font-size: 10.5px;
}

.upload-guide {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 8px 4px;
}

.guide-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--accent-text);
  font-size: 12.5px;
  font-weight: 700;
}

.guide-steps {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin: 20px 0;
  padding: 0;
  list-style: none;
}

.guide-steps li {
  display: flex;
  gap: 13px;
}

.guide-index {
  display: grid;
  place-items: center;
  width: 28px;
  height: 24px;
  flex: 0 0 auto;
  border-radius: 7px;
  background: var(--accent-soft);
  color: var(--accent-text);
  font-size: 10px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.guide-steps b {
  display: block;
  font-size: 12.5px;
  font-weight: 650;
}

.guide-steps p {
  margin-top: 2px;
  color: var(--text-3);
  font-size: 11.5px;
  line-height: 1.65;
}

.guide-note {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
  color: var(--text-3);
  font-size: 11px;
  line-height: 1.6;
}

.guide-note svg {
  flex: 0 0 auto;
  margin-top: 1px;
  color: var(--accent);
}

.blur-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 344px;
  gap: 20px;
  align-items: start;
}

.stage-card {
  min-width: 0;
  padding: 18px 18px 16px;
}

.stage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 14px;
}

.stage-file {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  color: var(--text-2);
  font-size: 12px;
}

.stage-file svg {
  flex: 0 0 auto;
  color: var(--accent);
}

.stage-file span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stage-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}

.stage {
  position: relative;
  width: 100%;
  margin: 0 auto;
  overflow: hidden;
  border-radius: 10px;
  background:
    linear-gradient(45deg, rgba(255, 255, 255, 0.03) 25%, transparent 25%) 0 0 / 18px 18px,
    linear-gradient(-45deg, rgba(255, 255, 255, 0.03) 25%, transparent 25%) 0 0 / 18px 18px,
    #0b1211;
  border: 1px solid rgba(0, 0, 0, 0.35);
  touch-action: none;
  user-select: none;
  cursor: crosshair;
}

.stage-video,
.stage-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.stage-video {
  object-fit: contain;
  pointer-events: none;
}

.stage-canvas {
  pointer-events: none;
}

.region {
  position: absolute;
  border: 1.5px solid rgba(255, 255, 255, 0.86);
  border-radius: 3px;
  background: rgba(13, 148, 136, 0.1);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
  cursor: move;
}

.region.selected {
  border-color: #2dd4bf;
  background: rgba(45, 212, 191, 0.12);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4), 0 0 0 3px rgba(45, 212, 191, 0.18);
}

.region-tag {
  position: absolute;
  top: -19px;
  left: -1px;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  display: grid;
  place-items: center;
  border-radius: 4px 4px 4px 0;
  background: #2dd4bf;
  color: #04201c;
  font-size: 9.5px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.region-handle {
  position: absolute;
  width: 10px;
  height: 10px;
  border: 2px solid #04201c;
  border-radius: 50%;
  background: #2dd4bf;
  cursor: nwse-resize;
}

.region-handle.nw { left: -6px; top: -6px; }
.region-handle.ne { right: -6px; top: -6px; cursor: nesw-resize; }
.region-handle.sw { left: -6px; bottom: -6px; cursor: nesw-resize; }
.region-handle.se { right: -6px; bottom: -6px; }

.stage-hint {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 18px;
  border-radius: 10px;
  background: rgba(6, 15, 14, 0.62);
  color: rgba(236, 255, 251, 0.82);
  font-size: 11.5px;
  pointer-events: none;
  backdrop-filter: blur(4px);
}

.stage-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: #0b1211;
  color: #7f938f;
  font-size: 12px;
}

.scrubber {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 13px;
}

.time {
  flex: 0 0 auto;
  min-width: 42px;
  color: var(--text-3);
  font-size: 10.5px;
  text-align: center;
}

.timeline {
  flex: 1;
  min-width: 0;
}

.frame-buttons {
  display: flex;
  gap: 2px;
  flex: 0 0 auto;
}

.frame-buttons .btn {
  padding: 0 7px;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}

.stage-note {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 10px;
  color: var(--text-3);
  font-size: 10.5px;
  line-height: 1.55;
}

.stage-note svg {
  flex: 0 0 auto;
  margin-top: 1px;
}

.stage-warning {
  margin-top: 7px;
  padding: 7px 10px;
  border-radius: 7px;
  background: var(--warning-soft);
  color: var(--warning);
  font-size: 10.5px;
  line-height: 1.5;
}

.settings-card {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px;
}

.settings-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.step-title {
  display: flex;
  align-items: center;
  gap: 9px;
}

.step {
  display: inline-grid;
  place-items: center;
  min-width: 27px;
  height: 21px;
  padding: 0 5px;
  border-radius: 6px;
  background: var(--accent-soft);
  color: var(--accent-text);
  font-size: 10.5px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
}

.step-title h3 {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.area-count {
  color: var(--text-3);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.field {
  display: flex;
  flex-direction: column;
}

.mode-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2);
}

.mode-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  height: 54px;
  justify-content: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text-3);
  font-size: 10.5px;
  font-weight: 600;
  transition: background 0.16s ease, color 0.16s ease, box-shadow 0.16s ease;
}

.mode-card:hover:not(:disabled) {
  color: var(--text);
}

.mode-card.active {
  background: var(--surface);
  color: var(--accent-text);
  box-shadow: 0 1px 3px rgba(16, 32, 29, 0.12);
}

.mode-card:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.range-scale {
  display: flex;
  justify-content: space-between;
  margin-top: 2px;
  color: var(--text-3);
  font-size: 9.5px;
}

.color-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.color-value {
  color: var(--text-2);
  font-size: 12px;
  letter-spacing: 0.03em;
}

.quality-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.quality-option {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface-2);
  text-align: left;
  transition: border-color 0.16s ease, background 0.16s ease;
}

.quality-option:hover:not(:disabled) {
  border-color: var(--border-2);
}

.quality-option.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.quality-option:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.radio {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  border: 1.5px solid var(--border-2);
  border-radius: 50%;
  background: var(--surface);
  transition: border-color 0.16s ease, box-shadow 0.16s ease;
}

.quality-option.active .radio {
  border-color: var(--accent);
  box-shadow: inset 0 0 0 3px var(--accent), inset 0 0 0 7px var(--surface);
}

.quality-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.quality-copy b {
  font-size: 11.5px;
  font-weight: 650;
}

.quality-copy > span {
  margin-top: 1px;
  color: var(--text-3);
  font-size: 10px;
}

.engine-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 11px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface-2);
}

.engine-copy {
  min-width: 0;
}

.engine-copy b {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  font-weight: 650;
}

.engine-copy span {
  display: block;
  margin-top: 1px;
  color: var(--text-3);
  font-size: 10px;
  line-height: 1.45;
}

.regions-field {
  padding-top: 2px;
  border-top: 1px solid var(--border);
  margin-top: 2px;
}

.regions-field .field-label {
  margin-top: 14px;
}

.empty-regions {
  padding: 13px;
  border: 1px dashed var(--border);
  border-radius: 9px;
  background: var(--surface-2);
  color: var(--text-3);
  font-size: 10.5px;
  line-height: 1.6;
  text-align: center;
}

.region-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.region-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  text-align: left;
  transition: border-color 0.16s ease, background 0.16s ease;
}

.region-row:hover {
  border-color: var(--border-2);
}

.region-row.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.region-number {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 5px;
  background: var(--surface-3);
  color: var(--text-2);
  font-size: 9.5px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.region-row.selected .region-number {
  background: var(--accent);
  color: var(--accent-contrast);
}

.region-meta {
  flex: 1;
  min-width: 0;
  color: var(--text-2);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}

.region-meta i {
  display: block;
  margin-top: 1px;
  color: var(--text-3);
  font-style: normal;
  font-size: 9.5px;
}

.region-remove {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  border-radius: 6px;
  color: var(--text-3);
  cursor: pointer;
}

.region-remove:hover {
  background: var(--danger-soft);
  color: var(--danger);
}

.clear-regions {
  align-self: flex-start;
  margin-top: 3px;
  color: var(--danger);
}

.output-card {
  min-height: 150px;
}

.output-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.output-summary {
  color: var(--text-3);
  font-size: 11.5px;
}

.generate-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.generate-copy strong {
  display: block;
  font-size: 13.5px;
  font-weight: 650;
}

.generate-copy span {
  display: block;
  max-width: 720px;
  margin-top: 3px;
  color: var(--text-3);
  font-size: 11.5px;
  line-height: 1.65;
}

.progress-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 11px;
}

.progress-copy strong {
  display: block;
  font-size: 13.5px;
  font-weight: 650;
}

.progress-copy span {
  display: block;
  margin-top: 2px;
  color: var(--text-3);
  font-size: 11.5px;
}

.progress-head b {
  color: var(--accent-text);
  font-size: 20px;
  font-weight: 720;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.progress-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}

.result-block {
  display: grid;
  grid-template-columns: minmax(260px, 380px) minmax(0, 1fr);
  gap: 22px;
  align-items: center;
}

.result-preview {
  overflow: hidden;
  border-radius: 10px;
  background: #0b1211;
}

.result-preview video {
  display: block;
  width: 100%;
  max-height: 250px;
  object-fit: contain;
}

.result-info {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0 13px;
  align-items: start;
}

.success-badge {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--success-soft);
  color: var(--success);
}

.result-copy {
  min-width: 0;
}

.result-copy strong {
  display: block;
  font-size: 14.5px;
  font-weight: 700;
}

.result-copy span {
  display: block;
  margin-top: 3px;
  color: var(--text-2);
  font-size: 12px;
}

.result-copy code {
  display: block;
  margin-top: 7px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-3);
  font-family: var(--mono);
  font-size: 10.5px;
}

.result-actions {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}

@media (max-width: 1080px) {
  .blur-grid {
    grid-template-columns: 1fr;
  }
  .upload-layout {
    grid-template-columns: 1fr;
  }
  .result-block {
    grid-template-columns: 1fr;
  }
}
</style>
