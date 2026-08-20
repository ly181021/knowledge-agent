/**
 * router/index.ts —— src/router/index.ts
 * 路由守卫：无 token 跳 login；requiresAdmin 但 role≠ADMIN 也跳 login
 */
import { createRouter, createWebHistory } from 'vue-router'
import routes from './routes'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  const isPublic = to.meta.public === true

  // 公开路由直接放行
  if (isPublic) return true

  // 演示模式直接放行所有路由（写请求会被后端 PreviewModeInterceptor 拦）
  if (auth.previewMode) return true

  // 无 token → 登录
  if (!auth.token) {
    return { name: 'AdminLogin', query: { redirect: to.fullPath } }
  }

  // 需要 ADMIN 但当前不是 ADMIN → 登录
  if (to.meta.requiresAdmin && auth.role !== 'ADMIN') {
    return { name: 'AdminLogin' }
  }

  return true
})

export default router
