import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { initTheme } from './composables/useTheme'
import { initJobBridge } from './composables/useJob'
import './styles/base.css'

initTheme()
initJobBridge()

createApp(App).use(router).mount('#app')
