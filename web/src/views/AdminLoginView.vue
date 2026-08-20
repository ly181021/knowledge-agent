<script setup lang="ts">
/**
 * AdminLoginView —— 管理员登录页
 * el-form 登录 → 调 authApi.login → 存 store → 跳 /admin
 */
import { ref, reactive } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { authApi, type LoginRes } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const formRef = ref<FormInstance>()
const loading = ref(false)
const form = reactive({ username: '', password: '' })

const rules: FormRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码至少 6 位', trigger: 'blur' },
  ],
}

async function onSubmit() {
  if (!formRef.value) return
  await formRef.value.validate(async (valid) => {
    if (!valid) return
    loading.value = true
    try {
      const res = (await authApi.login(form.username, form.password)) as unknown as LoginRes
      auth.login(res.token, res.user.role as 'USER' | 'ADMIN', res.user.username)
      ElMessage.success('登录成功')
      const redirect = (route.query.redirect as string) || '/admin'
      router.push(redirect)
    } catch {
      // 拦截器已提示
    } finally {
      loading.value = false
    }
  })
}

/** 进入演示模式：无需账号，直接跳聊天页（只读） */
function onEnterPreview() {
  auth.setPreview()
  ElMessage.success('已进入演示模式（只读）')
  router.push('/chat')
}
</script>

<template>
  <div class="login-wrap">
    <div class="login-card">
      <div class="login-logo-area">
        <div class="login-mark">✦</div>
        <div class="login-logo">Knowledge Agent</div>
      </div>
      <p class="login-subtitle">企业智能助手 · 管理后台</p>
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="onSubmit">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" placeholder="请输入用户名" autocomplete="username" size="large" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" type="password" show-password placeholder="请输入密码" autocomplete="current-password" size="large" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" size="large" style="width: 100%" @click="onSubmit">登录</el-button>
        </el-form-item>
      </el-form>
      <button class="preview-btn" type="button" @click="onEnterPreview">
        演示模式进入（只读）
      </button>
    </div>
  </div>
</template>

<style scoped>
.login-wrap {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: var(--sa-bg-sidebar);
}
.login-card {
  width: 400px;
  max-width: calc(100% - 32px);
  padding: 48px 40px;
  background: var(--sa-bg-card);
  border-radius: var(--sa-radius-lg);
  box-shadow: var(--sa-shadow-pop);
}
.login-logo-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.login-mark {
  font-size: 32px;
  color: var(--sa-primary);
}
.login-logo {
  font-size: 24px;
  font-weight: 600;
  color: var(--sa-text-primary);
  text-align: center;
}
.login-subtitle {
  font-size: 14px;
  color: var(--sa-text-secondary);
  text-align: center;
  margin-bottom: 32px;
}
.login-card :deep(.el-input__wrapper) {
  border-radius: var(--sa-radius-sm);
  background: var(--sa-bg-sidebar);
}
.login-card :deep(.el-button) {
  border-radius: var(--sa-radius-sm);
  font-weight: 500;
  height: 44px;
}
.preview-btn {
  width: 100%;
  margin-top: 12px;
  padding: 10px 16px;
  border: 1px solid var(--sa-primary);
  border-radius: var(--sa-radius-sm);
  background: transparent;
  color: var(--sa-primary);
  font-size: 14px;
  cursor: pointer;
  transition: var(--sa-transition);
}
.preview-btn:hover {
  background: var(--sa-bg-hover);
}
</style>
