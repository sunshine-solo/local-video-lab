<script setup>
import { onBeforeUnmount, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppSidebar from '@/components/AppSidebar.vue'
import ToastHost from '@/components/ToastHost.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { loadSettings } from '@/composables/useSettings'
import { loadEngineInfo } from '@/composables/useEngine'
import { loadAppInfo } from '@/composables/useAppInfo'

const router = useRouter()
let aboutListener = null

onMounted(() => {
  loadSettings()
  loadEngineInfo()
  loadAppInfo()
  aboutListener = window.api.onShowAbout(() => router.push('/about'))
})

onBeforeUnmount(() => {
  if (aboutListener != null) window.api.offShowAbout(aboutListener)
})
</script>

<template>
  <div class="app-shell">
    <AppSidebar />
    <main class="main-area">
      <RouterView v-slot="{ Component }">
        <Transition name="page" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>
    <ToastHost />
    <ConfirmDialog />
  </div>
</template>
