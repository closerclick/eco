import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import '@closerclick/closer-click-support'
import '@closerclick/closer-click-profile'
import { createBackNav } from '@closerclick/closer-click-nav'
import './style.css'

// Navegación "volver" unificada del ecosistema: el botón físico de Android / el
// gesto de iOS / el atrás del navegador y el chevron del header comparten la
// misma cascada (modal → vista anterior → página anterior → closer.click).
createBackNav()

const app = createApp(App)
app.use(createPinia())
app.mount('#app')
