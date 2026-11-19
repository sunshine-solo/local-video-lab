<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import {
  Clapperboard,
  House,
  Film,
  Sparkles,
  Settings,
  Info,
  Lock,
} from '@lucide/vue'
import { engineState, engineStatusText, engineReady } from '@/composables/useEngine'
import { settingsState } from '@/composables/useSettings'
import { appInfo } from '@/composables/useAppInfo'

const route = useRoute()

const groups = [
  {
    label: '工具',
    items: [
      { to: '/', label: '首页', icon: House, exact: true },
      { to: '/blur', label: '视频去水印', icon: Sparkles },
      { to: '/joiner', label: '视频拼接', icon: Film },
    ],
  },
  {
    label: '系统',
    items: [
      { to: '/settings', label: '设置', icon: Settings },
      { to: '/about', label: '关于', icon: Info },
    ],
  },
]

const isActive = (item) => (
  item.exact ? route.path === item.to : route.path.startsWith(item.to)
)

const statusClass = computed(() => {
  if (engineState.error) return 'bad'
  if (!engineState.loaded) return 'warn'
  return engineReady.value ? 'ok' : 'warn'
})

const encoderText = computed(() => {
  if (!engineState.info?.ffmpegVersion) {
    return engineState.loading ? '正在检测编码器' : '尚未检测到引擎'
  }
  if (settingsState.hardwareAcceleration === false) return '软件编码模式'
  if (engineState.info.hardwareEncoder) {
    return `${engineState.info.hardwareEncoderLabel || engineState.info.hardwareEncoder} 加速`
  }
  return 'libx264 软件编码'
})

const platformText = computed(() => {
  const platformMap = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }
  const archMap = { arm64: 'arm64', x64: 'x64', ia32: 'x86' }
  const platform = platformMap[appInfo.platform] || '桌面端'
  const arch = archMap[appInfo.arch] || appInfo.arch
  return arch ? `${platform} · ${arch}` : platform
})
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark">
        <Clapperboard :size="20" :stroke-width="2.2" />
      </div>
      <div class="brand-copy">
        <strong>文艺文视频工坊</strong>
        <span>LOCAL VIDEO LAB</span>
      </div>
    </div>

    <nav class="nav">
      <div v-for="group in groups" :key="group.label" class="nav-group">
        <p class="nav-label">{{ group.label }}</p>
        <RouterLink
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          class="nav-item"
          :class="{ active: isActive(item) }"
        >
          <component :is="item.icon" :size="17" :stroke-width="1.9" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </div>
    </nav>

    <div class="sidebar-footer">
      <RouterLink to="/settings" class="engine-card">
        <div class="engine-top">
          <span class="status-dot" :class="statusClass"></span>
          <span class="engine-status">{{ engineStatusText }}</span>
        </div>
        <div class="engine-sub">{{ encoderText }}</div>
        <div class="engine-meta">
          <span>{{ platformText }}</span>
          <span v-if="appInfo.version">v{{ appInfo.version }}</span>
        </div>
      </RouterLink>
      <p class="privacy-line">
        <Lock :size="12" />
        <span>所有文件仅在本机处理</span>
      </p>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 22px 14px 16px;
  background:
    radial-gradient(400px 240px at 50% -10%, rgba(23, 179, 164, 0.16), transparent 70%),
    var(--sidebar-bg);
  border-right: 1px solid var(--sidebar-border);
  color: var(--sidebar-text);
  user-select: none;
}

.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 4px 10px 22px;
}

.brand-mark {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 11px;
  color: #04201c;
  background: linear-gradient(145deg, #5eead4, #14b8a6 55%, #0d9488);
  box-shadow: 0 8px 20px -10px rgba(20, 184, 166, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.35);
}

.brand-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.brand-copy strong {
  color: var(--sidebar-text-strong);
  font-size: 14.5px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.brand-copy span {
  margin-top: 1px;
  color: var(--sidebar-text);
  font-size: 9.5px;
  font-weight: 650;
  letter-spacing: 0.14em;
  opacity: 0.72;
}

.nav {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding: 2px 0;
}

.nav-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.nav-label {
  padding: 0 12px 7px;
  color: var(--sidebar-text);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.12em;
  opacity: 0.55;
}

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 11px;
  height: 39px;
  padding: 0 12px;
  border-radius: 9px;
  color: var(--sidebar-text);
  font-size: 13.5px;
  font-weight: 550;
  text-decoration: none;
  transition: background 0.16s ease, color 0.16s ease;
}

.nav-item:hover {
  background: var(--sidebar-surface-hover);
  color: var(--sidebar-text-strong);
  text-decoration: none;
}

.nav-item.active {
  background: linear-gradient(90deg, rgba(23, 179, 164, 0.22), rgba(23, 179, 164, 0.055));
  color: #ecfffb;
}

.nav-item.active::before {
  content: "";
  position: absolute;
  left: -14px;
  top: 10px;
  bottom: 10px;
  width: 3px;
  border-radius: 0 4px 4px 0;
  background: #2dd4bf;
  box-shadow: 0 0 12px rgba(45, 212, 191, 0.55);
}

.sidebar-footer {
  flex: 0 0 auto;
  padding-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.engine-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 12px 13px;
  border: 1px solid var(--sidebar-border);
  border-radius: 11px;
  background: var(--sidebar-surface);
  color: var(--sidebar-text);
  text-decoration: none;
  transition: background 0.16s ease, border-color 0.16s ease;
}

.engine-card:hover {
  background: var(--sidebar-surface-hover);
  border-color: rgba(255, 255, 255, 0.14);
  text-decoration: none;
}

.engine-top {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--sidebar-text-strong);
  font-size: 12px;
  font-weight: 650;
}

.status-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #94a3a0;
}

.status-dot.ok {
  background: #34d399;
  box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.14);
}

.status-dot.warn {
  background: #fbbf24;
  box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.12);
  animation: pulse 1.6s ease-in-out infinite;
}

.status-dot.bad {
  background: #f87171;
  box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.14);
}

@keyframes pulse {
  50% { opacity: 0.45; }
}

.engine-status {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.engine-sub {
  padding-left: 14px;
  font-size: 11px;
  line-height: 1.4;
  opacity: 0.85;
}

.engine-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
  padding-left: 14px;
  font-size: 10px;
  letter-spacing: 0.02em;
  opacity: 0.55;
}

.privacy-line {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  color: var(--sidebar-text);
  font-size: 10.5px;
  opacity: 0.55;
}
</style>
