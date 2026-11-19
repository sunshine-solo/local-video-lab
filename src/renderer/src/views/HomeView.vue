<script setup>
import { computed } from 'vue'
import {
  ArrowRight,
  Film,
  Sparkles,
  Zap,
  ShieldCheck,
  Cpu,
  Gauge,
  Lock,
  Check,
  CircuitBoard,
  Layers,
} from '@lucide/vue'
import PageHeader from '@/components/PageHeader.vue'
import { engineState, engineReady, engineStatusText } from '@/composables/useEngine'
import { settingsState } from '@/composables/useSettings'
import { appInfo } from '@/composables/useAppInfo'

const platformLabel = computed(() => {
  const platforms = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }
  const arches = { arm64: 'arm64', x64: 'x64', ia32: 'x86' }
  const platform = platforms[appInfo.platform] || '桌面端'
  const arch = arches[appInfo.arch] || ''
  return arch ? `${platform} · ${arch}` : platform
})

const encoderText = computed(() => {
  if (!engineState.info?.ffmpegVersion) return '正在检测'
  if (settingsState.hardwareAcceleration === false) return 'libx264 · 已关闭硬件加速'
  const encoder = engineState.info.hardwareEncoder
  return encoder ? `${engineState.info.hardwareEncoderLabel || encoder} 硬件加速` : 'libx264 软件编码'
})

const statusClass = computed(() => {
  if (engineState.error) return 'bad'
  if (!engineState.loaded) return 'warn'
  return engineReady.value ? 'ok' : 'warn'
})

const engineRows = computed(() => [
  {
    icon: Cpu,
    label: 'FFmpeg 版本',
    value: engineState.info?.ffmpegVersion || (engineState.loading ? '检测中…' : '—'),
  },
  {
    icon: CircuitBoard,
    label: '视频编码',
    value: encoderText.value,
  },
  {
    icon: Layers,
    label: '运行平台',
    value: platformLabel.value,
  },
])

const principles = [
  {
    icon: Zap,
    title: '原生 FFmpeg',
    text: '直接调用本机编译好的 FFmpeg 可执行文件，不再受浏览器 WebAssembly 单线程的性能限制。',
  },
  {
    icon: Gauge,
    title: '硬件编码',
    text: '自动检测 VideoToolbox、NVENC、Intel Quick Sync 与 AMD AMF，可用时优先使用 GPU 编码。',
  },
  {
    icon: Lock,
    title: '完全本地',
    text: '视频不会离开你的电脑。应用不发起网络请求，也没有账号、上传或遥测。',
  },
]
</script>

<template>
  <div class="page">
    <PageHeader
      title="文艺文视频工坊"
      subtitle="围绕原生 FFmpeg 打造的桌面视频工具。把视频处理留在这台电脑上，速度更快，隐私也更简单。"
      badge="原生 FFmpeg · 本地处理"
    />

    <section class="hero card">
      <div class="hero-copy">
        <div class="eyebrow">
          <Zap :size="13" />
          <span>NATIVE ENGINE · NO UPLOAD</span>
        </div>
        <h2>原生性能，<br />处理视频不再等待。</h2>
        <p>
          去水印与拼接都直接在本机调用 FFmpeg 与硬件编码器。同样的素材，
          无需上传、无需排队，处理速度取决于你的电脑，而不是浏览器。
        </p>
        <div class="hero-chips">
          <span class="pill"><ShieldCheck /> 文件不上传</span>
          <span class="pill"><Cpu /> 多核 / GPU 编码</span>
          <span class="pill"><Layers /> 无水印导出</span>
        </div>
        <div class="hero-actions">
          <RouterLink to="/blur" class="btn btn-primary btn-lg">
            去除水印
            <ArrowRight :size="17" />
          </RouterLink>
          <RouterLink to="/joiner" class="btn btn-secondary btn-lg">
            视频拼接
          </RouterLink>
        </div>
      </div>

      <div class="engine-panel">
        <div class="engine-head">
          <div class="engine-title">
            <span class="status-dot" :class="statusClass"></span>
            <strong>{{ engineStatusText }}</strong>
          </div>
          <RouterLink to="/settings" class="engine-link">引擎设置</RouterLink>
        </div>
        <div class="engine-rows">
          <div v-for="row in engineRows" :key="row.label" class="engine-row">
            <div class="engine-row-label">
              <component :is="row.icon" :size="14" />
              <span>{{ row.label }}</span>
            </div>
            <span class="engine-row-value" :title="row.value">{{ row.value }}</span>
          </div>
        </div>
        <div class="engine-foot">
          <span>{{ appInfo.name }}</span>
          <span v-if="appInfo.version">v{{ appInfo.version }}</span>
        </div>
        <div class="engine-orbit orbit-a"></div>
        <div class="engine-orbit orbit-b"></div>
      </div>
    </section>

    <section class="tool-grid">
      <article class="tool-card card blur">
        <div class="tool-top">
          <div class="tool-icon"><Sparkles :size="22" /></div>
          <span class="pill">核心功能</span>
        </div>
        <h3>视频去水印</h3>
        <p class="tool-desc">
          框选画面中的水印区域，用模糊、马赛克或纯色块遮挡整段视频。
          预览与导出使用同一套参数，所见即所得。
        </p>
        <ul class="tool-points">
          <li><Check :size="14" /> 最多 8 个区域，可拖动与缩放</li>
          <li><Check :size="14" /> 输出分辨率、帧率与原片保持一致</li>
          <li><Check :size="14" /> 码率对齐原片，文件体积不会莫名其妙变大</li>
        </ul>
        <RouterLink to="/blur" class="tool-link">
          打开视频去水印
          <ArrowRight :size="15" />
        </RouterLink>
      </article>

      <article class="tool-card card joiner">
        <div class="tool-top">
          <div class="tool-icon"><Film :size="22" /></div>
          <span class="pill">无损优先</span>
        </div>
        <h3>视频拼接</h3>
        <p class="tool-desc">
          把 2–6 段视频按队列顺序合成一个 MP4。参数一致时直接无损拼接；
          不一致时自动统一画布、帧率与编码参数。
        </p>
        <ul class="tool-points">
          <li><Check :size="14" /> 同参数素材 stream copy，秒级完成</li>
          <li><Check :size="14" /> 自动适配横屏 / 竖屏与不同分辨率</li>
          <li><Check :size="14" /> 输出 H.264 / AAC，兼容常见播放器</li>
        </ul>
        <RouterLink to="/joiner" class="tool-link">
          打开视频拼接
          <ArrowRight :size="15" />
        </RouterLink>
      </article>
    </section>

    <section class="principles">
      <article v-for="item in principles" :key="item.title" class="principle card">
        <div class="principle-icon">
          <component :is="item.icon" :size="17" />
        </div>
        <div>
          <h4>{{ item.title }}</h4>
          <p>{{ item.text }}</p>
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped>
.hero {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(300px, 0.7fr);
  gap: 28px;
  padding: 30px;
  overflow: hidden;
  background:
    radial-gradient(620px 320px at 100% 0%, var(--accent-soft), transparent 66%),
    var(--surface);
}

.hero::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(var(--border) 1px, transparent 1px),
    linear-gradient(90deg, var(--border) 1px, transparent 1px);
  background-size: 34px 34px;
  mask-image: radial-gradient(420px 260px at 88% 8%, rgba(0, 0, 0, 0.5), transparent 75%);
  opacity: 0.22;
}

.hero-copy {
  position: relative;
  z-index: 1;
}

.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--accent-text);
  font-size: 10.5px;
  font-weight: 750;
  letter-spacing: 0.14em;
}

.hero h2 {
  margin-top: 15px;
  font-size: 38px;
  font-weight: 780;
  line-height: 1.16;
  letter-spacing: -0.035em;
}

.hero-copy > p {
  max-width: 560px;
  margin-top: 14px;
  color: var(--text-2);
  font-size: 14px;
  line-height: 1.75;
}

.hero-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 20px;
}

.hero-actions {
  display: flex;
  gap: 10px;
  margin-top: 26px;
}

.engine-panel {
  position: relative;
  z-index: 1;
  align-self: center;
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--surface) 78%, transparent);
  backdrop-filter: blur(10px);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

.engine-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 13px;
  border-bottom: 1px solid var(--border);
}

.engine-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 12.5px;
}

.engine-title strong {
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #94a3a0;
}

.status-dot.ok {
  background: var(--success);
  box-shadow: 0 0 0 3px var(--success-soft);
}

.status-dot.warn {
  background: var(--warning);
  box-shadow: 0 0 0 3px var(--warning-soft);
}

.status-dot.bad {
  background: var(--danger);
  box-shadow: 0 0 0 3px var(--danger-soft);
}

.engine-link {
  flex: 0 0 auto;
  color: var(--text-3);
  font-size: 11.5px;
  text-decoration: none;
}

.engine-link:hover {
  color: var(--accent-text);
  text-decoration: none;
}

.engine-rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 0;
}

.engine-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  font-size: 12px;
}

.engine-row-label {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--text-3);
  flex: 0 0 auto;
}

.engine-row-value {
  color: var(--text);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
}

.engine-foot {
  display: flex;
  justify-content: space-between;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  color: var(--text-3);
  font-size: 10.5px;
  letter-spacing: 0.03em;
}

.engine-orbit {
  position: absolute;
  border: 1px solid var(--accent-soft-2);
  border-radius: 50%;
  pointer-events: none;
  opacity: 0.6;
}

.orbit-a {
  width: 180px;
  height: 180px;
  right: -90px;
  bottom: -110px;
}

.orbit-b {
  width: 260px;
  height: 260px;
  right: -135px;
  bottom: -150px;
  opacity: 0.35;
}

.tool-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}

.tool-card {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 24px;
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.tool-card:hover {
  transform: translateY(-2px);
  border-color: var(--border-2);
  box-shadow: 0 2px 4px rgba(16, 32, 29, 0.04), 0 26px 50px -34px rgba(16, 32, 29, 0.4);
}

.tool-card.joiner { --tool-accent: #0d7d72; --tool-soft: var(--accent-soft); }
.tool-card.blur { --tool-accent: #0e7490; --tool-soft: color-mix(in srgb, #0e7490 12%, var(--surface)); }

.tool-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.tool-icon {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border-radius: 13px;
  background: var(--tool-soft);
  color: var(--tool-accent);
}

.tool-card h3 {
  margin-top: 16px;
  font-size: 19px;
  font-weight: 720;
  letter-spacing: -0.02em;
}

.tool-desc {
  margin-top: 7px;
  color: var(--text-2);
  font-size: 13px;
  line-height: 1.7;
}

.tool-points {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 16px 0 22px;
  padding: 0;
  list-style: none;
}

.tool-points li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: var(--text-2);
  font-size: 12.5px;
  line-height: 1.5;
}

.tool-points svg {
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--tool-accent);
}

.tool-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: auto;
  color: var(--tool-accent);
  font-size: 13px;
  font-weight: 650;
  text-decoration: none;
}

.tool-link:hover {
  gap: 9px;
  text-decoration: none;
}

.tool-link svg {
  transition: transform 0.16s ease;
}

.principles {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.principle {
  display: flex;
  gap: 13px;
  padding: 18px 18px 19px;
  box-shadow: none;
  background: color-mix(in srgb, var(--surface) 72%, transparent);
}

.principle-icon {
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 9px;
  background: var(--accent-soft);
  color: var(--accent-text);
}

.principle h4 {
  font-size: 12.5px;
  font-weight: 700;
}

.principle p {
  margin-top: 4px;
  color: var(--text-3);
  font-size: 11.5px;
  line-height: 1.65;
}

@media (max-width: 1080px) {
  .hero {
    grid-template-columns: 1fr;
  }
  .hero h2 {
    font-size: 32px;
  }
  .principles {
    grid-template-columns: 1fr;
  }
}
</style>
