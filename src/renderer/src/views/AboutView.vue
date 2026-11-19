<script setup>
import {
  Clapperboard,
  ShieldCheck,
  Zap,
  CodeXml,
  Heart,
  ExternalLink,
  BookOpen,
  Cpu,
  Check,
  Lock,
  Layers,
  Settings,
} from '@lucide/vue'
import PageHeader from '@/components/PageHeader.vue'
import { appInfo } from '@/composables/useAppInfo'

const noticesUrl = appInfo.repoUrl
  ? `${appInfo.repoUrl.replace(/\/$/, '')}/blob/main/THIRD_PARTY_NOTICES.md`
  : '#'

const values = [
  {
    icon: Lock,
    title: '本地优先',
    text: '视频、音频与帧数据都只存在于你的电脑。应用不包含上传接口，也不依赖任何云端服务。',
  },
  {
    icon: Zap,
    title: '原生性能',
    text: '直接调用本机编译的 FFmpeg，而不是浏览器里的 WebAssembly；可用时自动启用硬件编码。',
  },
  {
    icon: CodeXml,
    title: '开源透明',
    text: '完整源码、构建脚本与处理命令都公开可查。你可以自己编译，也可以替换 FFmpeg 版本。',
  },
]

const stack = [
  { name: 'Electron', desc: '跨平台桌面运行时，负责窗口、文件对话框与本地进程调用。' },
  { name: 'Vue 3', desc: '渲染层使用 Composition API 与 Vue Router 构建交互界面。' },
  { name: 'Vite', desc: '开发热更新与生产构建，配合 electron-vite 打包主进程与预加载脚本。' },
  { name: 'FFmpeg', desc: '所有拼接、转码与滤镜处理的执行核心，以独立进程方式运行。' },
  { name: 'electron-builder', desc: '生成 macOS DMG / ZIP 与 Windows NSIS 安装包。' },
]
</script>

<template>
  <div class="page about-page">
    <PageHeader
      title="关于"
      subtitle="一个完全本地运行的视频工具，为速度和隐私而做。"
      badge="开源项目"
    />

    <section class="card about-hero">
      <div class="brand-mark">
        <Clapperboard :size="28" :stroke-width="2" />
      </div>
      <div class="hero-copy">
        <div class="title-row">
          <h2>文艺文视频工坊</h2>
          <span v-if="appInfo.version" class="pill">v{{ appInfo.version }}</span>
          <span class="pill">GPL-3.0</span>
          <span class="pill pill-accent"><ShieldCheck :size="12" /> 不上传</span>
        </div>
        <p>
          把浏览器里又慢又受限制的视频处理搬到桌面：去水印、拼接都由原生 FFmpeg
          完成。没有账号、没有云端队列，也没有隐藏的网络请求。
        </p>
        <div class="hero-actions">
          <a
            class="btn btn-primary"
            :href="appInfo.repoUrl || '#'"
            target="_blank"
            rel="noreferrer"
          >
            <CodeXml :size="16" />
            项目主页
            <ExternalLink :size="14" />
          </a>
          <RouterLink to="/settings" class="btn btn-secondary">
            <Settings :size="15" />
            引擎设置
          </RouterLink>
        </div>
      </div>
    </section>

    <section class="values">
      <article v-for="item in values" :key="item.title" class="card value-card">
        <div class="value-icon"><component :is="item.icon" :size="18" /></div>
        <h3>{{ item.title }}</h3>
        <p>{{ item.text }}</p>
      </article>
    </section>

    <div class="split-grid">
      <section class="card">
        <div class="card-title">
          <h3>技术栈</h3>
          <span class="hint">Electron {{ appInfo.electron || '45' }}</span>
        </div>
        <div class="stack-list">
          <div v-for="item in stack" :key="item.name" class="stack-row">
            <span class="stack-name">{{ item.name }}</span>
            <span class="stack-desc">{{ item.desc }}</span>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-title">
          <h3>隐私说明</h3>
          <span class="pill pill-accent"><Lock :size="12" /> 本地</span>
        </div>
        <ul class="check-list">
          <li><Check :size="14" /> 默认不联网，也不收集遥测数据；只有手动点击“检查更新”时才访问 GitHub API。</li>
          <li><Check :size="14" /> 不读取与任务无关的文件，不上传任何内容。</li>
          <li><Check :size="14" /> 转码中间文件写入系统临时目录，完成后自动删除。</li>
          <li><Check :size="14" /> 设置与输出目录偏好只保存在本机用户数据目录。</li>
        </ul>
        <div class="privacy-foot">
          <Cpu :size="14" />
          <span>网络断开时，全部功能依然可用。</span>
        </div>
      </section>
    </div>

    <section class="card license-card">
      <div class="card-title">
        <h3>许可与第三方组件</h3>
        <span class="pill"><BookOpen :size="12" /> 开源许可</span>
      </div>
      <p>
        本项目以 <b>GPL-3.0-or-later</b> 发布。安装包内置的 FFmpeg / FFprobe 静态二进制
        以 GPL 许可分发，其源码可从
        <a href="https://ffmpeg.org/" target="_blank" rel="noreferrer">ffmpeg.org</a>
        获取。你也可以在设置页替换为自己编译的 FFmpeg（例如 LGPL 构建）。
      </p>
      <p>
        应用代码、Electron、Vue、Vite 等组件的完整许可信息见第三方声明文件。
      </p>
      <div class="license-actions">
        <a class="btn btn-secondary btn-sm" :href="noticesUrl" target="_blank" rel="noreferrer">
          <Layers :size="14" />
          查看第三方声明
          <ExternalLink :size="12" />
        </a>
        <a class="btn btn-ghost btn-sm" href="https://ffmpeg.org/legal.html" target="_blank" rel="noreferrer">
          FFmpeg 许可说明
          <ExternalLink :size="12" />
        </a>
      </div>
    </section>

    <footer class="about-footer">
      <Heart :size="13" />
      <span>为需要批量处理视频、又不想上传文件的人而做。</span>
    </footer>
  </div>
</template>

<style scoped>
.about-page {
  max-width: 1080px;
}

.about-hero {
  display: flex;
  align-items: flex-start;
  gap: 22px;
  padding: 28px;
  background:
    radial-gradient(520px 260px at 92% -20%, var(--accent-soft), transparent 68%),
    var(--surface);
}

.brand-mark {
  width: 64px;
  height: 64px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 18px;
  color: var(--accent-contrast);
  background: linear-gradient(145deg, var(--accent-hover), var(--accent) 55%, #094e47);
  box-shadow: 0 16px 34px -18px var(--accent);
}

.hero-copy {
  min-width: 0;
}

.title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.title-row h2 {
  margin-right: 4px;
  font-size: 24px;
  font-weight: 760;
  letter-spacing: -0.025em;
}

.hero-copy > p {
  max-width: 700px;
  margin-top: 10px;
  color: var(--text-2);
  font-size: 13px;
  line-height: 1.75;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
  margin-top: 20px;
}

.values {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.value-card {
  padding: 20px;
}

.value-icon {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--accent-text);
}

.value-card h3 {
  margin-top: 13px;
  font-size: 13.5px;
  font-weight: 700;
}

.value-card p {
  margin-top: 5px;
  color: var(--text-3);
  font-size: 11.5px;
  line-height: 1.7;
}

.split-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

.stack-list {
  display: flex;
  flex-direction: column;
}

.stack-row {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}

.stack-row:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.stack-name {
  color: var(--accent-text);
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 650;
}

.stack-desc {
  color: var(--text-3);
  font-size: 11px;
  line-height: 1.6;
}

.check-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.check-list li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: var(--text-2);
  font-size: 11.5px;
  line-height: 1.6;
}

.check-list svg {
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--success);
}

.privacy-foot {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 16px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--surface-2);
  color: var(--text-3);
  font-size: 10.5px;
}

.privacy-foot svg {
  color: var(--accent);
}

.license-card p {
  margin-bottom: 10px;
  color: var(--text-2);
  font-size: 12px;
  line-height: 1.75;
}

.license-card p b {
  color: var(--text);
}

.license-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}

.about-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 4px 0 10px;
  color: var(--text-3);
  font-size: 10.5px;
}

.about-footer svg {
  color: var(--danger);
}

@media (max-width: 1080px) {
  .values {
    grid-template-columns: 1fr;
  }
  .split-grid {
    grid-template-columns: 1fr;
  }
  .about-hero {
    flex-direction: column;
  }
}
</style>
