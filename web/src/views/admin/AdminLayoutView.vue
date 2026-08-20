<script setup lang="ts">
/**
 * AdminLayoutView —— 管理后台整体布局
 * el-container 布局：header(用户名+登出) + aside(菜单) + main(router-view)
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()
const menuOpen = ref(false)

function onLogout() {
  auth.logout()
  ElMessage.success('已登出')
  router.push('/admin/login')
}
</script>

<template>
  <el-container class="layout">
    <el-header class="header">
      <div v-if="auth.previewMode" class="preview-banner">
        <span class="preview-dot"></span>
        当前为演示模式（只读）
      </div>
      <div class="header-left">
        <button
          class="menu-toggle"
          :aria-label="menuOpen ? '关闭菜单' : '打开菜单'"
          :aria-expanded="menuOpen"
          @click="menuOpen = !menuOpen"
        >
          <span aria-hidden="true">☰</span>
        </button>
        <span class="logo">Knowledge Agent</span>
        <el-button text size="small" @click="router.push('/chat')">← 返回对话</el-button>
      </div>
      <div class="user">
        <span class="username">{{ auth.username }}</span>
        <el-button text size="small" @click="onLogout">登出</el-button>
      </div>
    </el-header>

    <el-container>
      <el-aside :width="menuOpen ? '200px' : '200px'" class="aside" :class="{ 'is-open': menuOpen }">
        <el-menu :default-active="$route.path" router class="side-menu" @select="menuOpen = false">
          <el-menu-item index="/admin/dashboard">
            <el-icon><TrendCharts /></el-icon>
            <span>运营总览</span>
          </el-menu-item>
          <el-menu-item index="/admin/documents">
            <el-icon><Document /></el-icon>
            <span>文档管理</span>
          </el-menu-item>
          <el-menu-item index="/admin/observability">
            <el-icon><DataAnalysis /></el-icon>
            <span>可观测看板</span>
          </el-menu-item>
        </el-menu>
      </el-aside>
      <div v-if="menuOpen" class="aside-backdrop" aria-hidden="true" @click="menuOpen = false" />

      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.layout { height: 100vh; background: var(--sa-bg); }
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--sa-bg-card);
  border-bottom: 1px solid var(--sa-border);
  height: 52px;
  padding: 0 20px;
}
.header-left { display: flex; align-items: center; gap: 12px; }
.logo {
  font-size: 17px;
  font-weight: 600;
  color: var(--sa-text-primary);
}
.logo::before {
  content: '✦';
  color: var(--sa-primary);
  margin-right: 6px;
}
.user { display: flex; align-items: center; gap: 12px; }
.username { font-size: 14px; color: var(--sa-text-secondary); }
.preview-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  border: 1px solid var(--sa-primary);
  border-radius: var(--sa-radius-sm);
  background: var(--sa-bg-hover);
  color: var(--sa-primary);
  font-size: 12px;
  font-weight: 500;
}
.preview-dot {
  width: 8px; height: 8px;
  background: var(--sa-primary);
  border-radius: 50%;
  flex-shrink: 0;
}
.aside { background: var(--sa-bg-sidebar); border-right: 1px solid var(--sa-border); }
.side-menu { border-right: none; background: transparent; }
.side-menu :deep(.el-menu-item) {
  border-radius: var(--sa-radius-sm);
  margin: 4px 8px;
  color: var(--sa-text-regular);
  height: 40px;
}
.side-menu :deep(.el-menu-item:hover) { background: var(--sa-bg-hover); }
/* 方案 B：选中项陶土浅底 + 陶土色文字 + 左侧陶土竖条强调 */
.side-menu :deep(.el-menu-item.is-active) {
  background: var(--sa-primary-light);
  color: var(--sa-primary-pressed);
  font-weight: 600;
}
.main { background: var(--sa-bg); padding: 24px; }

/* ===== 响应式：≤768px 菜单抽屉化，主区贴边 ===== */
.menu-toggle {
  display: none;
  width: var(--sa-touch-target); height: var(--sa-touch-target);
  border: 1px solid var(--sa-border-input);
  border-radius: var(--sa-radius-sm);
  background: var(--sa-bg-input);
  color: var(--sa-text-primary);
  font-size: 18px;
  cursor: pointer;
  align-items: center;
  justify-content: center;
}
.menu-toggle:hover { background: var(--sa-bg-hover); }
.aside-backdrop {
  position: fixed; inset: 0;
  background: var(--sa-overlay);
  z-index: 15;
}

@media (max-width: 768px) {
  .header { padding: 0 12px; }
  .main { padding: 16px 12px; }
  .menu-toggle { display: inline-flex; }
  .aside {
    position: fixed;
    top: 52px; left: 0; bottom: 0;
    z-index: 16;
    width: 200px !important;
    transform: translateX(-100%);
  }
  .aside.is-open { transform: translateX(0); box-shadow: var(--sa-shadow-pop); }
}
</style>
