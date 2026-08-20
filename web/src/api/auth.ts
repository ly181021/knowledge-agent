/**
 * auth api —— 鉴权接口
 */
import { http } from './request'

export interface LoginRes {
  token: string
  user: { id: string; username: string; role: string }
}

export const authApi = {
  login(username: string, password: string) {
    return http.post<LoginRes>('/auth/login', { username, password })
  },
  getProfile() {
    return http.get('/auth/profile')
  },
}
