import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'

// ElMessage / ElMessageBox 等命令式服务无模板标签，unplugin 扫不到其样式，需手动引入
import './styles/element-services.css'
// Element Plus 主色覆盖：用 html:root 提高优先级，摆脱与 theme.css 的加载顺序竞争
import './styles/element-theme-override.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.mount('#app')
