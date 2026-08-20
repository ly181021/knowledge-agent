<script setup lang="ts">
/**
 * SidebarFooter —— 后台管理入口
 * 展开态文字 + 图标，收起态只图标
 * 跳转 /admin（重定向到运营总览，侧栏可见 运营总览/文档管理/可观测看板 三个菜单项）
 */
import { useRouter } from 'vue-router'
const router = useRouter()

defineProps<{ collapsed: boolean }>()

function go(path: string) { router.push(path) }
</script>

<template>
  <div class="sidebar-footer">
    <button class="footer-btn" data-test="footer-admin" @click="go('/admin')">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 3v18h18" /><path d="M7 14l4-4 4 4 5-5" />
      </svg>
      <span v-if="!collapsed" class="lbl">后台管理</span>
    </button>
  </div>
</template>

<style scoped>
.sidebar-footer {
  padding: 8px 8px 8px;
  border-top: 1px solid var(--sa-border);
  display: flex; flex-direction: column; gap: 2px;
}
.footer-btn {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px;
  border: none; background: transparent;
  border-radius: var(--sa-radius-sm);
  color: var(--sa-text-secondary); font-size: 14px;
  cursor: pointer; text-align: left;
  transition: background 0.15s ease, color 0.15s ease;
}
.footer-btn:hover { background: var(--sa-bg-hover); color: var(--sa-text-primary); }
.footer-btn:focus-visible { outline: none; box-shadow: var(--sa-focus-ring); }
.footer-btn svg { flex-shrink: 0; }
/* 收起态居中（父级 .sidebar.collapsed 时生效），左右无 padding 与会话项/新对话按钮对齐 */
:global(.sidebar.collapsed) .footer-btn { justify-content: center; padding: 8px 0; }
</style>
