/** axios 实例 + 拦截器 */
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import router from '@/router'

export const http = axios.create({
  baseURL: '/api/v1',
  timeout: 20000,
})

// 请求拦截：加 JWT
http.interceptors.request.use((config) => {
  const t = useAuthStore().token
  if (t) config.headers.Authorization = `Bearer ${t}`
  return config
})

// 响应拦截：解包 {code,message,data} + 错误提示 + 401 跳转
http.interceptors.response.use(
  (r) => r.data?.data ?? r.data,
  (e) => {
    // 401：区分登录接口账号密码错 与 其他接口 token 过期
    if (e.response?.status === 401) {
      const auth = useAuthStore()
      const isLoginRequest = e.config?.url?.includes('/auth/login')

      if (isLoginRequest) {
        // 登录接口本身 401 = 账号密码错误，不清 token 不跳转，只提示
        ElMessage.error(e.response?.data?.message ?? '用户名或密码错误')
        return Promise.reject(e)
      }

      // 其他接口 401 = token 过期/无效，清 token 跳登录
      auth.logout()
      ElMessage.warning('登录已过期，请重新登录')
      if (router.currentRoute.value.name !== 'AdminLogin') {
        router.push({ name: 'AdminLogin' })
      }
      return Promise.reject(e)
    }
    ElMessage.error(e.response?.data?.message ?? e.message)
    return Promise.reject(e)
  },
)
