/**
 * 路由表 —— src/router/routes.ts
 * admin 登录 + admin 文档管理
 */
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/chat',
    name: 'BusinessChat',
    component: () => import('@/views/BusinessChatView.vue'),
    meta: { requiresAuth: true, title: '智能问答' },
  },
  {
    path: '/admin/login',
    name: 'AdminLogin',
    component: () => import('@/views/AdminLoginView.vue'),
    meta: { public: true, title: '管理员登录' },
  },
  {
    path: '/admin',
    component: () => import('@/views/admin/AdminLayoutView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, title: '管理后台' },
    redirect: '/admin/dashboard',
    children: [
      {
        path: 'dashboard',
        name: 'AdminDashboard',
        component: () => import('@/views/admin/AdminDashboardView.vue'),
        meta: { title: '运营总览' },
      },
      {
        path: 'documents',
        name: 'AdminDocuments',
        component: () => import('@/views/admin/AdminDocumentListView.vue'),
        meta: { title: '文档管理' },
      },
      {
        path: 'documents/:id',
        name: 'AdminDocumentDetail',
        component: () => import('@/views/admin/AdminDocumentDetailPageView.vue'),
        meta: { title: '文档详情' },
      },
      {
        path: 'observability',
        name: 'AdminObservability',
        component: () => import('@/views/admin/AdminObservabilityListView.vue'),
        meta: { title: '可观测看板' },
      },
      {
        path: 'observability/:id',
        name: 'AdminObservabilitySession',
        component: () => import('@/views/admin/AdminObservabilitySessionView.vue'),
        meta: { title: '会话 Trace' },
      },
    ],
  },
  // 兜底：未匹配的路径都跳聊天
  {
    path: '/:pathMatch(.*)*',
    redirect: '/chat',
  },
]

export default routes
