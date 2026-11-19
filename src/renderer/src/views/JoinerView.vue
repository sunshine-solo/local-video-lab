<script setup>
import { computed, ref } from 'vue'
import {
  Upload,
  Film,
  Plus,
  ArrowUp,
  ArrowDown,
  Trash2,
  FolderOpen,
  Play,
  Check,
  LoaderCircle,
  Clock,
  HardDrive,
  Monitor,
  FileVideo,
  RefreshCw,
  CircleStop,
  Combine,
  Layers,
  ShieldCheck,
  ArrowRight,
} from '@lucide/vue'
import PageHeader from '@/components/PageHeader.vue'
import ProgressBar from '@/components/ProgressBar.vue'
import { useJob, beginJob, endJob } from '@/composables/useJob'
import { toast } from '@/composables/useToast'
import { confirm } from '@/composables/useConfirm'
import {
  basename,
  createId,
  fileStamp,
  formatDuration,
  formatResolution,
  formatSize,
} from '@/utils/format'

const MAX_ITEMS = 6
const LARGE_FILE_BYTES = 2 * 1024 * 1024 * 1024

const job = useJob()

const items = ref([])
const adding = ref(false)
const isDragging = ref(false)
const dragDepth = ref(0)
const processing = ref(false)
const cancelling = ref(false)
const result = ref(null)
const currentJobId = ref('')

const isFull = computed(() => items.value.length >= MAX_ITEMS)
const isBusy = computed(() => processing.value || adding.value)
const readyItems = computed(() => items.value.filter((item) => item.status === 'ready'))
const canJoin = computed(() => (
  items.value.length >= 2
  && readyItems.value.length === items.value.length
  && !isBusy.value
))
const totalDuration = computed(() => (
  items.value.reduce((sum, item) => sum + (Number(item.duration) || 0), 0)
))
const knownDuration = computed(() => totalDuration.value > 0)
const modeLabel = computed(() => {
  if (!result.value) return ''
  if (result.value.mode === 'copy') return '无损快速拼接'
  return `${result.value.encoderLabel || 'libx264'} 转码`
})
const generateTitle = computed(() => {
  if (items.value.length < 2) return '至少添加 2 段视频'
  if (readyItems.value.length !== items.value.length) return '正在读取素材信息'
  return '素材已就绪，可以开始拼接'
})
const generateHint = computed(() => {
  if (items.value.length < 2) {
    return '队列中的视频将按从上到下的顺序合并为一个 MP4。'
  }
  return '输出方向跟随第一段视频；参数不一致时会自动统一画布并补黑边，参数一致时直接无损拼接。'
})

const mediaUrl = (filePath) => window.api.toMediaUrl(filePath)

function resetResult() {
  result.value = null
}

async function addPaths(paths) {
  if (processing.value) return
  if (adding.value) {
    toast.info('正在读取上一批素材，请稍候')
    return
  }
  const filePaths = [...new Set(paths.filter(Boolean))]
  if (!filePaths.length) return

  const available = MAX_ITEMS - items.value.length
  if (available <= 0) {
    toast.info(`最多添加 ${MAX_ITEMS} 段视频`)
    return
  }
  const selected = filePaths.slice(0, available)
  if (filePaths.length > available) {
    toast.info(`最多添加 ${MAX_ITEMS} 段视频，超出的文件未添加`)
  }

  const newItems = selected.map((filePath) => ({
    id: createId('item'),
    path: filePath,
    name: basename(filePath),
    size: 0,
    duration: 0,
    width: 0,
    height: 0,
    video: null,
    audio: null,
    status: 'probing',
    error: '',
    previewError: false,
  }))
  items.value.push(...newItems)
  resetResult()
  adding.value = true

  try {
    await Promise.all(newItems.map(async (item) => {
      const response = await window.api.probe(item.path)
      if (response?.ok) {
        const info = response.info
        item.size = info.size
        item.duration = info.duration
        item.width = info.video.width
        item.height = info.video.height
        item.video = info.video
        item.audio = info.audio
        item.status = 'ready'
        if (info.size > LARGE_FILE_BYTES) {
          toast.warning(`${item.name} 超过 2GB，处理时间可能较长`)
        }
      } else {
        item.status = 'error'
        item.error = response?.error || '无法读取视频'
        toast.error(`${item.name}：${item.error}`)
      }
    }))
  } finally {
    // 读取失败的素材无法参与处理，直接从队列移除。
    items.value = items.value.filter((item) => item.status !== 'error')
    adding.value = false
  }
}

async function pickVideos() {
  if (isFull.value || isBusy.value) return
  const response = await window.api.selectVideos()
  if (response?.paths?.length) addPaths(response.paths)
}

function onDragEnter() {
  if (isFull.value || isBusy.value) return
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
  if (isFull.value || isBusy.value) return
  const files = Array.from(event.dataTransfer?.files || [])
  const paths = files
    .map((file) => {
      try {
        return window.api.getPathForFile(file)
      } catch {
        return ''
      }
    })
    .filter(Boolean)
  if (!paths.length) {
    toast.warning('未能读取拖入文件的路径，请使用“添加视频”按钮')
    return
  }
  addPaths(paths)
}

function moveItem(index, offset) {
  if (isBusy.value) return
  const target = index + offset
  if (target < 0 || target >= items.value.length) return
  const [item] = items.value.splice(index, 1)
  items.value.splice(target, 0, item)
  resetResult()
}

function removeItem(index) {
  if (isBusy.value) return
  items.value.splice(index, 1)
  resetResult()
}

async function clearAll() {
  if (isBusy.value) return
  const agreed = await confirm({
    title: '清空视频队列？',
    message: '当前添加的素材与已生成的结果都会被清除，源文件不受影响。',
    confirmText: '清空队列',
    danger: true,
  })
  if (!agreed) return
  items.value = []
  resetResult()
}

async function startJoin() {
  if (!canJoin.value) return
  const output = await window.api.selectOutput({
    fileName: `视频拼接_${fileStamp()}.mp4`,
    title: '保存拼接结果',
  })
  if (!output?.ok) return

  processing.value = true
  cancelling.value = false
  resetResult()
  const jobId = createId('join')
  currentJobId.value = jobId
  beginJob(jobId)

  try {
    const response = await window.api.startJoin({
      jobId,
      items: items.value.map((item) => ({ path: item.path })),
      outputPath: output.path,
    })
    if (response?.ok) {
      result.value = response
      toast.success('视频拼接完成')
    } else if (response?.cancelled) {
      toast.info('已取消处理')
    } else {
      toast.error(response?.error || '视频拼接失败，请重试')
    }
  } catch (error) {
    toast.error(error?.message || '视频拼接失败，请重试')
  } finally {
    processing.value = false
    cancelling.value = false
    currentJobId.value = ''
    endJob()
  }
}

async function cancelJoin() {
  if (!processing.value || cancelling.value) return
  cancelling.value = true
  await window.api.cancelJob(currentJobId.value)
}

function revealResult() {
  if (result.value?.outputPath) window.api.revealFile(result.value.outputPath)
}

function openResult() {
  if (result.value?.outputPath) window.api.openPath(result.value.outputPath)
}

function openPath(filePath) {
  if (filePath) window.api.openPath(filePath)
}
</script>

<template>
  <div class="page">
    <PageHeader
      title="视频拼接"
      subtitle="选择 2–6 段本地视频，按队列顺序合并为一个 MP4。参数一致的素材会直接无损拼接，不做二次编码。"
    >
      <template #actions>
        <span v-if="items.length" class="pill">{{ items.length }} / {{ MAX_ITEMS }} 段</span>
      </template>
    </PageHeader>

    <div class="joiner-grid">
      <section class="card add-card">
        <div class="step-head">
          <span class="step">01</span>
          <h3>添加素材</h3>
        </div>

        <button
          class="dropzone"
          type="button"
          data-testid="joiner-add"
          :class="{ dragging: isDragging, disabled: isFull || isBusy }"
          :disabled="isFull || isBusy"
          @click="pickVideos"
          @dragenter.prevent="onDragEnter"
          @dragover.prevent
          @dragleave.prevent="onDragLeave"
          @drop.prevent="onDrop"
        >
          <span class="drop-icon"><Upload :size="23" /></span>
          <strong>{{ isFull ? '队列已满' : '选择本地视频' }}</strong>
          <span class="drop-hint">也可以把文件拖到这里 · MP4 / MOV / WebM / MKV</span>
          <span class="drop-split">{{ items.length }} / {{ MAX_ITEMS }}</span>
        </button>

        <div class="add-notes">
          <div class="add-note">
            <Film :size="15" />
            <div><b>2–6 段素材</b><span>按队列从上到下依次拼接</span></div>
          </div>
          <div class="add-note">
            <Layers :size="15" />
            <div><b>智能匹配</b><span>分辨率不同时自动统一画布</span></div>
          </div>
        </div>

        <p class="privacy-note">
          <ShieldCheck :size="13" />
          文件仅在本机处理，不会上传到任何服务器。
        </p>
      </section>

      <section class="card queue-card">
        <div class="step-head queue-head">
          <div class="step-title">
            <span class="step">02</span>
            <h3>拼接顺序</h3>
          </div>
          <div class="queue-actions">
            <button
              v-if="items.length"
              class="btn btn-ghost btn-sm"
              type="button"
              :disabled="isBusy"
              @click="clearAll"
            >
              清空
            </button>
            <button
              class="btn btn-secondary btn-sm"
              type="button"
              :disabled="isFull || isBusy"
              @click="pickVideos"
            >
              <Plus :size="14" />
              添加视频
            </button>
          </div>
        </div>

        <div v-if="!items.length" class="empty-state">
          <div class="empty-icon"><Film :size="26" /></div>
          <strong>等待添加视频</strong>
          <span>队列中的视频将从上到下依次拼接</span>
          <button class="empty-link" type="button" @click="pickVideos">
            选择本地视频
            <ArrowRight :size="13" />
          </button>
        </div>

        <div v-else class="queue">
          <article
            v-for="(item, index) in items"
            :key="item.id"
            class="queue-item"
            data-testid="queue-item"
          >
            <span class="order-index">{{ String(index + 1).padStart(2, '0') }}</span>

            <div class="thumb">
              <video
                v-if="item.status === 'ready' && !item.previewError"
                :src="`${mediaUrl(item.path)}#t=0.1`"
                preload="metadata"
                muted
                playsinline
                @error="item.previewError = true"
              ></video>
              <div v-else class="thumb-placeholder">
                <LoaderCircle v-if="item.status === 'probing'" :size="20" class="spin" />
                <FileVideo v-else :size="20" />
                <span>{{ item.status === 'probing' ? '读取中' : '无法预览' }}</span>
              </div>
              <button
                v-if="item.status === 'ready' && !item.previewError"
                class="thumb-play"
                type="button"
                title="用系统播放器预览"
                aria-label="用系统播放器预览"
                @click.stop="openPath(item.path)"
              >
                <Play :size="14" />
              </button>
              <span v-if="item.duration" class="thumb-duration">{{ formatDuration(item.duration) }}</span>
            </div>

            <div class="item-body">
              <div class="item-name" :title="item.name">{{ item.name }}</div>
              <div v-if="item.status === 'ready'" class="item-meta">
                <span><Clock :size="12" />{{ formatDuration(item.duration) }}</span>
                <span><Monitor :size="12" />{{ formatResolution(item.width, item.height) }}</span>
                <span><HardDrive :size="12" />{{ formatSize(item.size) }}</span>
                <span v-if="item.video?.codec" class="codec">{{ item.video.codec.toUpperCase() }}</span>
              </div>
              <div v-else class="item-meta probing">
                <LoaderCircle :size="12" class="spin" />
                正在读取媒体信息…
              </div>
              <p v-if="item.previewError" class="preview-warning">缩略预览不可用，不影响拼接处理</p>
            </div>

            <div class="item-actions">
              <button
                class="btn btn-icon btn-sm"
                type="button"
                title="上移"
                aria-label="上移"
                :disabled="index === 0 || isBusy"
                @click="moveItem(index, -1)"
              >
                <ArrowUp :size="14" />
              </button>
              <button
                class="btn btn-icon btn-sm"
                type="button"
                title="下移"
                aria-label="下移"
                :disabled="index === items.length - 1 || isBusy"
                @click="moveItem(index, 1)"
              >
                <ArrowDown :size="14" />
              </button>
              <button
                class="btn btn-icon btn-sm btn-danger-ghost"
                type="button"
                title="删除"
                aria-label="删除"
                :disabled="isBusy"
                @click="removeItem(index)"
              >
                <Trash2 :size="14" />
              </button>
            </div>
          </article>
        </div>
      </section>
    </div>

    <section class="card output-card">
      <div class="output-head">
        <div class="step-title">
          <span class="step">03</span>
          <h3>生成视频</h3>
        </div>
        <div v-if="items.length" class="output-summary">
          {{ items.length }} 段<span v-if="knownDuration"> · {{ formatDuration(totalDuration) }}</span>
        </div>
      </div>

      <div v-if="processing" class="progress-block" data-testid="join-progress">
        <div class="progress-head">
          <div class="progress-copy">
            <strong>{{ job.message || '正在处理' }}</strong>
            <span>{{ job.detail || '正在准备 FFmpeg 任务' }}</span>
          </div>
          <b>{{ Math.round(job.percent) }}%</b>
        </div>
        <ProgressBar :value="job.percent" />
        <div class="progress-actions">
          <button class="btn btn-ghost btn-sm" type="button" :disabled="cancelling" @click="cancelJoin">
            <CircleStop :size="14" />
            {{ cancelling ? '正在取消…' : '取消处理' }}
          </button>
        </div>
      </div>

      <div v-else-if="result" class="result-block" data-testid="join-result">
        <div class="result-preview">
          <video :src="mediaUrl(result.outputPath)" controls playsinline></video>
        </div>
        <div class="result-info">
          <div class="success-badge"><Check :size="17" /></div>
          <div class="result-copy">
            <strong>拼接完成</strong>
            <span>
              {{ formatSize(result.size) }} · {{ formatResolution(result.width, result.height) }} · {{ modeLabel }}
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
              再拼一次
            </button>
          </div>
        </div>
      </div>

      <div v-else class="generate-row">
        <div class="generate-copy">
          <strong>{{ generateTitle }}</strong>
          <span>{{ generateHint }}</span>
        </div>
        <button class="btn btn-primary btn-lg" type="button" data-testid="join-start" :disabled="!canJoin" @click="startJoin">
          <Combine :size="17" />
          开始拼接
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.joiner-grid {
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

.step-head,
.step-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.step-head {
  justify-content: space-between;
  margin-bottom: 16px;
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

.step-head h3,
.step-title h3 {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.add-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dropzone {
  position: relative;
  width: 100%;
  height: 214px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 20px;
  border: 1.5px dashed var(--border-2);
  border-radius: 13px;
  background: var(--surface-2);
  color: var(--text);
  text-align: center;
  transition: border-color 0.16s ease, background 0.16s ease, transform 0.16s ease;
}

.dropzone:not(:disabled):hover,
.dropzone.dragging {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.dropzone.dragging {
  transform: scale(0.995);
}

.dropzone:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.drop-icon {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  margin-bottom: 5px;
  border-radius: 13px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--accent);
  box-shadow: var(--shadow-card);
}

.dropzone strong {
  font-size: 14px;
  font-weight: 680;
}

.drop-hint {
  color: var(--text-3);
  font-size: 11.5px;
}

.drop-split {
  position: absolute;
  top: 12px;
  right: 12px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-3);
  font-size: 10.5px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}

.add-notes {
  display: flex;
  flex-direction: column;
  gap: 11px;
  padding: 2px 2px 0;
}

.add-note {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  color: var(--accent-text);
}

.add-note svg {
  margin-top: 2px;
  flex: 0 0 auto;
}

.add-note b {
  display: block;
  color: var(--text);
  font-size: 12px;
  font-weight: 650;
}

.add-note span {
  display: block;
  margin-top: 1px;
  color: var(--text-3);
  font-size: 11.5px;
}

.privacy-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: auto;
  padding-top: 14px;
  border-top: 1px solid var(--border);
  color: var(--text-3);
  font-size: 11px;
}

.queue-head {
  margin-bottom: 14px;
}

.queue-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.empty-state {
  min-height: 296px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px dashed var(--border);
  border-radius: 13px;
  background: var(--surface-2);
  text-align: center;
}

.empty-icon {
  width: 54px;
  height: 54px;
  display: grid;
  place-items: center;
  margin-bottom: 8px;
  border-radius: 15px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-3);
}

.empty-state strong {
  font-size: 13.5px;
  font-weight: 650;
}

.empty-state > span {
  color: var(--text-3);
  font-size: 11.5px;
}

.empty-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 10px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent-text);
  font-size: 12px;
  font-weight: 650;
}

.empty-link:hover {
  gap: 7px;
}

.queue {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 430px;
  overflow-y: auto;
  padding-right: 4px;
}

.queue-item {
  display: grid;
  grid-template-columns: 26px 132px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: var(--surface);
  transition: border-color 0.16s ease, box-shadow 0.16s ease;
}

.queue-item:hover {
  border-color: var(--border-2);
  box-shadow: var(--shadow-card);
}

.order-index {
  align-self: flex-start;
  padding-top: 2px;
  color: var(--text-3);
  font-size: 10.5px;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
}

.thumb {
  position: relative;
  width: 132px;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: 7px;
  background: #0d1514;
}

.thumb video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.thumb-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: #6f8380;
  font-size: 9.5px;
}

.thumb-duration {
  position: absolute;
  right: 4px;
  bottom: 4px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.68);
  color: #fff;
  font-size: 9.5px;
  font-variant-numeric: tabular-nums;
}

.thumb-play {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 50%;
  background: rgba(4, 15, 14, 0.62);
  color: #eafffb;
  opacity: 0;
  transform: translate(-50%, -50%);
  transition: opacity 0.16s ease, background 0.16s ease;
}

.thumb:hover .thumb-play,
.thumb-play:focus-visible {
  opacity: 1;
}

.thumb-play:hover {
  background: rgba(13, 148, 136, 0.85);
}

.item-body {
  min-width: 0;
}

.item-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  font-weight: 630;
}

.item-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  margin-top: 6px;
  color: var(--text-3);
  font-size: 10.5px;
}

.item-meta span {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.item-meta.probing {
  color: var(--accent-text);
}

.item-meta .codec {
  padding: 0 5px;
  border-radius: 4px;
  background: var(--surface-3);
  color: var(--text-2);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.preview-warning {
  margin-top: 5px;
  color: var(--warning);
  font-size: 10.5px;
}

.item-actions {
  display: flex;
  align-items: center;
  gap: 3px;
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
  font-variant-numeric: tabular-nums;
}

.generate-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 2px 0 2px;
}

.generate-copy {
  min-width: 0;
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
  background: #0d1514;
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
  .joiner-grid {
    grid-template-columns: 1fr;
  }
  .queue {
    max-height: none;
  }
  .result-block {
    grid-template-columns: 1fr;
  }
}
</style>
