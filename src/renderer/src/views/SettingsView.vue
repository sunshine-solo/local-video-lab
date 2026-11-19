<script setup>
import { computed, reactive, ref, watch } from 'vue'
import {
  RefreshCw,
  Cpu,
  HardDrive,
  Trash2,
  FolderSearch,
  Sun,
  Moon,
  Monitor,
  Check,
  LoaderCircle,
  CircleAlert,
  ShieldCheck,
  ArrowRight,
  SlidersHorizontal,
  Download,
  ExternalLink,
} from '@lucide/vue'
import PageHeader from '@/components/PageHeader.vue'
import { useEngine, engineReady } from '@/composables/useEngine'
import { useSettings } from '@/composables/useSettings'
import { useTheme } from '@/composables/useTheme'
import { appInfo } from '@/composables/useAppInfo'
import { toast } from '@/composables/useToast'
import { confirm } from '@/composables/useConfirm'

const { engine, loadEngineInfo } = useEngine()
const { settings, updateSettings } = useSettings()
const { mode: themeMode, setMode } = useTheme()

const draft = reactive({ ffmpegPath: '', ffprobePath: '' })
const initialized = ref(false)
const testing = ref(false)
const savingPaths = ref(false)
const clearingTemp = ref(false)
const updateState = reactive({
  checking: false,
  checked: false,
  result: null,
  error: '',
})

const updateAvailable = computed(() => Boolean(updateState.result?.hasUpdate))
const updateDownloadUrl = computed(() => (
  updateState.result?.downloadUrl || updateState.result?.releaseUrl || ''
))

async function checkUpdates() {
  if (updateState.checking) return
  updateState.checking = true
  updateState.error = ''
  updateState.result = null
  try {
    const result = await window.api.checkForUpdates()
    if (result?.ok) {
      updateState.result = result
    } else {
      updateState.error = result?.error || '检查更新失败'
    }
  } catch (error) {
    updateState.error = error?.message || '检查更新失败'
  } finally {
    updateState.checking = false
    updateState.checked = true
  }
}

watch(
  () => [settings.loaded, settings.ffmpegPath, settings.ffprobePath],
  () => {
    if (initialized.value || !settings.loaded) return
    draft.ffmpegPath = settings.ffmpegPath
    draft.ffprobePath = settings.ffprobePath
    initialized.value = true
  },
  { immediate: true },
)

const statusClass = computed(() => {
  if (engine.error || engine.info?.error) return 'bad'
  if (!engine.loaded) return 'warn'
  return engineReady.value ? 'ok' : 'warn'
})

const statusText = computed(() => {
  if (engine.error) return '引擎不可用'
  if (!engine.loaded) return '正在检测引擎'
  if (!engineReady.value) return '未检测到 FFmpeg'
  return 'FFmpeg 已就绪'
})

const hardwareLabel = computed(() => {
  if (!engine.info?.ffmpegVersion) return '—'
  if (engine.info.hardwareEncoder) {
    return engine.info.hardwareEncoderLabel || engine.info.hardwareEncoder
  }
  return '未检测到，使用 libx264'
})

const platformText = computed(() => {
  const platforms = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }
  return `${platforms[appInfo.platform] || '桌面端'} · ${appInfo.arch || ''}`.trim()
})

const themeOptions = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
]

async function browse(kind) {
  const result = await window.api.selectBinary(kind)
  if (!result?.ok) return
  if (kind === 'ffmpeg') draft.ffmpegPath = result.path
  else draft.ffprobePath = result.path
}

async function testPaths() {
  if (testing.value) return
  testing.value = true
  try {
    const result = await window.api.testBinaries({
      ffmpegPath: draft.ffmpegPath.trim(),
      ffprobePath: draft.ffprobePath.trim(),
    })
    if (result.ok) {
      toast.success(`可用：FFmpeg ${result.ffmpegVersion} / FFprobe ${result.ffprobeVersion}`, 5200)
    } else {
      toast.error(result.error || '路径不可用')
    }
  } finally {
    testing.value = false
  }
}

async function savePaths() {
  if (savingPaths.value) return
  savingPaths.value = true
  try {
    await updateSettings({
      ffmpegPath: draft.ffmpegPath.trim(),
      ffprobePath: draft.ffprobePath.trim(),
    })
    toast.success('路径已保存，正在重新检测引擎')
    await loadEngineInfo(true)
    if (draft.ffmpegPath.trim() && !engine.info?.usingCustomFfmpeg) {
      toast.warning('自定义 FFmpeg 不可用，已回退到内置版本')
    }
  } finally {
    savingPaths.value = false
  }
}

async function useBundled() {
  draft.ffmpegPath = ''
  draft.ffprobePath = ''
  await updateSettings({ ffmpegPath: '', ffprobePath: '' })
  toast.success('已恢复使用内置 FFmpeg')
  await loadEngineInfo(true)
}

async function redetect() {
  if (engine.loading) return
  await loadEngineInfo(true)
  if (engine.error) toast.error(engine.error)
  else toast.success('引擎检测完成')
}

async function toggleHardware() {
  const next = !settings.hardwareAcceleration
  await updateSettings({ hardwareAcceleration: next })
  toast.success(next ? '已启用硬件加速' : '已关闭硬件加速，将始终使用软件编码')
}

async function clearTemp() {
  if (clearingTemp.value) return
  const agreed = await confirm({
    title: '清理临时文件？',
    message: '会删除本应用在系统临时目录中留下的转码中间文件，不影响你的原片和已生成结果。',
    confirmText: '清理',
  })
  if (!agreed) return
  clearingTemp.value = true
  try {
    const result = await window.api.clearTemp()
    if (result?.ok) toast.success(`已清理 ${result.removed} 个临时目录`)
    else toast.error(result?.error || '清理失败')
  } finally {
    clearingTemp.value = false
  }
}
</script>

<template>
  <div class="page settings-page">
    <PageHeader
      title="设置"
      subtitle="查看本机 FFmpeg 引擎状态，配置自定义二进制路径、硬件加速与界面外观。"
      badge="本机配置"
    />

    <section class="card status-card">
      <div class="status-head">
        <div class="status-title">
          <span class="status-dot" :class="statusClass"></span>
          <div>
            <strong>{{ statusText }}</strong>
            <span>{{ appInfo.name }} <template v-if="appInfo.version">v{{ appInfo.version }}</template> · {{ platformText }}</span>
          </div>
        </div>
        <button class="btn btn-secondary btn-sm" type="button" :disabled="engine.loading" @click="redetect">
          <RefreshCw :size="14" :class="{ spin: engine.loading }" />
          {{ engine.loading ? '检测中…' : '重新检测' }}
        </button>
      </div>

      <div class="status-grid">
        <div class="stat">
          <span class="stat-icon"><Cpu :size="15" /></span>
          <div><span>FFmpeg 版本</span><b>{{ engine.info?.ffmpegVersion || '—' }}</b></div>
        </div>
        <div class="stat">
          <span class="stat-icon"><SlidersHorizontal :size="15" /></span>
          <div><span>FFprobe 版本</span><b>{{ engine.info?.ffprobeVersion || '—' }}</b></div>
        </div>
        <div class="stat">
          <span class="stat-icon"><HardDrive :size="15" /></span>
          <div><span>硬件编码器</span><b>{{ hardwareLabel }}</b></div>
        </div>
        <div class="stat">
          <span class="stat-icon"><ShieldCheck :size="15" /></span>
          <div><span>引擎来源</span><b>{{ engine.info?.usingCustomFfmpeg ? '自定义路径' : '应用内置' }}</b></div>
        </div>
      </div>

      <div v-if="engine.error || engine.info?.error" class="error-banner">
        <CircleAlert :size="15" />
        <span>{{ engine.error || engine.info?.error }}</span>
      </div>

      <div v-if="engine.info?.ffmpegPath" class="path-line">
        <span>当前 FFmpeg</span>
        <code :title="engine.info.ffmpegPath">{{ engine.info.ffmpegPath }}</code>
      </div>
    </section>

    <div class="settings-grid">
      <section class="card">
        <div class="card-title">
          <h3>FFmpeg 路径</h3>
          <span class="hint">留空使用内置版本</span>
        </div>

        <div class="field">
          <label class="field-label">FFmpeg 可执行文件</label>
          <div class="path-input-row">
            <input
              v-model="draft.ffmpegPath"
              class="field-input mono"
              type="text"
              :placeholder="engine.info?.bundledFfmpeg || '内置 FFmpeg'"
              spellcheck="false"
            />
            <button class="btn btn-secondary btn-icon" type="button" title="浏览" @click="browse('ffmpeg')">
              <FolderSearch :size="15" />
            </button>
          </div>
        </div>

        <div class="field">
          <label class="field-label">FFprobe 可执行文件</label>
          <div class="path-input-row">
            <input
              v-model="draft.ffprobePath"
              class="field-input mono"
              type="text"
              :placeholder="engine.info?.bundledFfprobe || '内置 FFprobe'"
              spellcheck="false"
            />
            <button class="btn btn-secondary btn-icon" type="button" title="浏览" @click="browse('ffprobe')">
              <FolderSearch :size="15" />
            </button>
          </div>
        </div>

        <div class="path-actions">
          <button class="btn btn-secondary btn-sm" type="button" :disabled="testing" @click="testPaths">
            <LoaderCircle v-if="testing" :size="14" class="spin" />
            <Check v-else :size="14" />
            测试路径
          </button>
          <button class="btn btn-primary btn-sm" type="button" :disabled="savingPaths" @click="savePaths">
            <LoaderCircle v-if="savingPaths" :size="14" class="spin" />
            保存并应用
          </button>
          <button class="btn btn-ghost btn-sm" type="button" @click="useBundled">
            恢复内置
          </button>
        </div>

        <p class="field-hint">
          适合已经安装 FFmpeg 的高级用户。自定义 ffprobe 留空时，会自动使用 FFmpeg 同目录下的 ffprobe。
        </p>
      </section>

      <section class="card">
        <div class="card-title">
          <h3>处理偏好</h3>
        </div>

        <div class="preference-row">
          <div class="preference-copy">
            <b>硬件编码加速</b>
            <span>
              自动检测 VideoToolbox / NVENC / Quick Sync / AMF。
              编码器不可用或处理失败时会自动回退到 libx264。
            </span>
          </div>
          <button
            class="switch"
            :class="{ on: settings.hardwareAcceleration }"
            type="button"
            role="switch"
            :aria-checked="settings.hardwareAcceleration"
            @click="toggleHardware"
          ></button>
        </div>

        <hr class="divider" />

        <div class="preference-row">
          <div class="preference-copy">
            <b>临时文件</b>
            <span>转码中间文件位于系统临时目录，正常完成后会自动删除。</span>
          </div>
          <button class="btn btn-secondary btn-sm" type="button" :disabled="clearingTemp" @click="clearTemp">
            <Trash2 :size="13" />
            清理
          </button>
        </div>

        <hr class="divider" />

        <div class="preference-row">
          <div class="preference-copy">
            <b>默认输出目录</b>
            <span class="path-text" :title="settings.lastOutputDir">
              {{ settings.lastOutputDir || '首次保存时选择，之后自动记住' }}
            </span>
          </div>
        </div>

        <hr class="divider" />

        <div class="preference-row">
          <div class="preference-copy">
            <b>数据目录</b>
            <span class="path-text" :title="appInfo.userData">{{ appInfo.userData }}</span>
          </div>
        </div>
      </section>
    </div>

    <section class="card">
      <div class="card-title">
        <h3>界面外观</h3>
        <span class="hint">设置会保存在本机</span>
      </div>
      <div class="theme-options">
        <button
          v-for="option in themeOptions"
          :key="option.value"
          class="theme-option"
          :class="{ active: themeMode === option.value }"
          type="button"
          @click="setMode(option.value)"
        >
          <span class="theme-icon"><component :is="option.icon" :size="18" /></span>
          <span>{{ option.label }}</span>
          <Check v-if="themeMode === option.value" :size="14" class="theme-check" />
        </button>
      </div>
    </section>

    <section class="card update-card">
      <div class="card-title">
        <h3>软件更新</h3>
        <span class="hint">当前版本 v{{ appInfo.version || '—' }}</span>
      </div>

      <div class="update-row">
        <div class="preference-copy">
          <b>检查 GitHub Releases</b>
          <span>仅在你点击按钮时访问 GitHub，不会后台上传视频或收集使用数据。</span>
        </div>
        <button class="btn btn-secondary btn-sm" type="button" :disabled="updateState.checking" @click="checkUpdates">
          <LoaderCircle v-if="updateState.checking" :size="14" class="spin" />
          <RefreshCw v-else :size="14" />
          {{ updateState.checking ? '检查中…' : '检查更新' }}
        </button>
      </div>

      <div v-if="updateState.error" class="update-message error">
        <CircleAlert :size="15" />
        <span>{{ updateState.error }}</span>
      </div>

      <div v-else-if="updateState.result" class="update-message" :class="{ success: !updateAvailable }">
        <template v-if="updateAvailable">
          <div class="update-version">
            <b>发现新版本 v{{ updateState.result.latestVersion }}</b>
            <span>当前版本 v{{ updateState.result.currentVersion }}</span>
          </div>
          <div class="update-actions">
            <a
              class="btn btn-primary btn-sm"
              :href="updateDownloadUrl"
              target="_blank"
              rel="noreferrer"
            >
              <Download :size="14" />
              下载更新
            </a>
            <a
              class="btn btn-ghost btn-sm"
              :href="updateState.result.releaseUrl"
              target="_blank"
              rel="noreferrer"
            >
              发布说明
              <ExternalLink :size="12" />
            </a>
          </div>
        </template>
        <template v-else-if="updateState.result.noRelease">
          <Check :size="15" />
          <span>仓库还没有发布版本。</span>
          <a :href="updateState.result.releaseUrl" target="_blank" rel="noreferrer">查看 Releases</a>
        </template>
        <template v-else>
          <Check :size="15" />
          <span>已是最新版本 v{{ updateState.result.currentVersion }}</span>
        </template>
      </div>
    </section>

    <RouterLink to="/about" class="card about-link">
      <div class="about-copy">
        <span class="about-kicker">OPEN SOURCE · GPL-3.0</span>
        <strong>了解文艺文视频工坊的设计与许可</strong>
        <span>技术栈、隐私说明、FFmpeg 许可与第三方组件列表。</span>
      </div>
      <ArrowRight :size="18" />
    </RouterLink>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 1080px;
}

.status-card {
  padding: 24px;
}

.status-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.status-title {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status-dot {
  width: 10px;
  height: 10px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #94a3a0;
}

.status-dot.ok {
  background: var(--success);
  box-shadow: 0 0 0 4px var(--success-soft);
}

.status-dot.warn {
  background: var(--warning);
  box-shadow: 0 0 0 4px var(--warning-soft);
}

.status-dot.bad {
  background: var(--danger);
  box-shadow: 0 0 0 4px var(--danger-soft);
}

.status-title strong {
  display: block;
  font-size: 15px;
  font-weight: 700;
}

.status-title span {
  display: block;
  margin-top: 2px;
  color: var(--text-3);
  font-size: 11px;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-top: 20px;
}

.stat {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2);
  min-width: 0;
}

.stat-icon {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--accent);
}

.stat div {
  min-width: 0;
}

.stat span {
  display: block;
  color: var(--text-3);
  font-size: 9.5px;
}

.stat b {
  display: block;
  margin-top: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  font-weight: 650;
}

.error-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: 9px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 11.5px;
  line-height: 1.55;
}

.error-banner svg {
  flex: 0 0 auto;
  margin-top: 1px;
}

.path-line {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  padding-top: 13px;
  border-top: 1px solid var(--border);
  font-size: 10.5px;
}

.path-line span {
  flex: 0 0 auto;
  color: var(--text-3);
}

.path-line code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-2);
  font-family: var(--mono);
  font-size: 10px;
}

.settings-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
  gap: 20px;
  align-items: start;
}

.field + .field {
  margin-top: 14px;
}

.path-input-row {
  display: flex;
  gap: 7px;
}

.path-input-row .field-input {
  flex: 1;
  min-width: 0;
  font-size: 11px;
}

.path-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 16px;
}

.preference-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
}

.preference-row:first-of-type {
  padding-top: 0;
}

.preference-row:last-of-type {
  padding-bottom: 0;
}

.preference-copy {
  min-width: 0;
}

.preference-copy b {
  display: block;
  font-size: 12px;
  font-weight: 650;
}

.preference-copy > span {
  display: block;
  margin-top: 2px;
  color: var(--text-3);
  font-size: 10.5px;
  line-height: 1.55;
}

.preference-copy .path-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mono);
  font-size: 9.5px;
}

.divider {
  margin: 2px 0;
}

.theme-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.theme-option {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 54px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 12px;
  font-weight: 600;
  transition: border-color 0.16s ease, background 0.16s ease, color 0.16s ease;
}

.theme-option:hover {
  border-color: var(--border-2);
}

.theme-option.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-text);
}

.theme-icon {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
}

.theme-check {
  margin-left: auto;
  color: var(--accent);
}

.update-card {
  padding: 20px 22px;
}

.update-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.update-message {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: 9px;
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 11.5px;
}

.update-message svg {
  flex: 0 0 auto;
}

.update-message.error {
  background: var(--danger-soft);
  color: var(--danger);
}

.update-message.success {
  background: var(--success-soft);
  color: var(--success);
}

.update-message a {
  color: var(--accent-text);
  font-weight: 600;
}

.update-version {
  flex: 1;
  min-width: 0;
}

.update-version b {
  display: block;
  color: var(--text);
  font-size: 12.5px;
  font-weight: 700;
}

.update-version span {
  display: block;
  margin-top: 1px;
  color: var(--text-3);
  font-size: 10.5px;
}

.update-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.about-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 20px 22px;
  text-decoration: none;
  color: var(--text);
  transition: border-color 0.16s ease, background 0.16s ease;
}

.about-link:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
  text-decoration: none;
}

.about-kicker {
  display: block;
  color: var(--accent-text);
  font-size: 9px;
  font-weight: 750;
  letter-spacing: 0.14em;
}

.about-copy strong {
  display: block;
  margin-top: 4px;
  font-size: 13.5px;
  font-weight: 680;
}

.about-copy > span:last-child {
  display: block;
  margin-top: 2px;
  color: var(--text-3);
  font-size: 11px;
}

.about-link > svg {
  flex: 0 0 auto;
  color: var(--accent);
}

@media (max-width: 1080px) {
  .status-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .settings-grid {
    grid-template-columns: 1fr;
  }
}
</style>
