<script setup lang="ts">
// 路由出口
</script>

<template>
  <router-view />
</template>

<style>
/* 全局设计 token */
@import './assets/theme.css';

/* 全局重置 —— 暖奶油底色 */
html, body, #app {
  margin: 0;
  padding: 0;
  height: 100%;
  background: var(--sa-bg);
  color: var(--sa-text-regular);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 15px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* 暖色调滚动条 */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--sa-border-input); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--sa-text-placeholder); }

/* 链接：陶土珊瑚色 */
a { color: var(--sa-primary); text-decoration: none; }
a:hover { color: var(--sa-primary-hover); }

* { box-sizing: border-box; }
</style>
