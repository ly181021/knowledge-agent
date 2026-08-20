/**
 * auth store
 * - token/role/username 三 ref + login/logout action
 * - localStorage 持久化（手动，不引额外插件）
 * - previewMode：只读演示模式，登录页 演示模式进入 按钮触发
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Role } from '@/types'

const TOKEN_KEY = 'knowledgeagent_token'
const ROLE_KEY = 'knowledgeagent_role'
const USERNAME_KEY = 'knowledgeagent_username'
const PREVIEW_KEY = 'knowledgeagent_preview'

function read(key: string): string | null {
  return localStorage.getItem(key)
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string>(read(TOKEN_KEY) ?? '')
  const role = ref<Role>((read(ROLE_KEY) as Role) ?? 'USER')
  const username = ref<string>(read(USERNAME_KEY) ?? '')
  const previewMode = ref<boolean>(read(PREVIEW_KEY) === 'true')

  function setAuth(t: string, r: Role, u: string) {
    token.value = t
    role.value = r
    username.value = u
    localStorage.setItem(TOKEN_KEY, t)
    localStorage.setItem(ROLE_KEY, r)
    localStorage.setItem(USERNAME_KEY, u)
  }

  function login(t: string, r: Role, u: string) {
    setAuth(t, r, u)
  }

  /** 进入演示模式：设占位 token 让守卫放行，标记 previewMode 让前端隐藏写操作 */
  function setPreview() {
    previewMode.value = true
    token.value = 'preview'
    role.value = 'USER'
    username.value = '演示用户'
    localStorage.setItem(PREVIEW_KEY, 'true')
    localStorage.setItem(TOKEN_KEY, 'preview')
    localStorage.setItem(ROLE_KEY, 'USER')
    localStorage.setItem(USERNAME_KEY, '演示用户')
  }

  function logout() {
    token.value = ''
    role.value = 'USER'
    username.value = ''
    previewMode.value = false
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(ROLE_KEY)
    localStorage.removeItem(USERNAME_KEY)
    localStorage.removeItem(PREVIEW_KEY)
  }

  return { token, role, username, previewMode, setAuth, login, setPreview, logout }
})
