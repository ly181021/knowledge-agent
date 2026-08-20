<script setup lang="ts">
/**
 * AdminObservabilitySessionView —— 会话 Trace 详情页
 * 单会话 trace 时间线 + 检索结果回溯
 */
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { observabilityApi } from '@/api/observability'
import TraceTimeline from '@/components/charts/TraceTimeline.vue'

const route = useRoute()
const router = useRouter()
const sessionId = route.params.id as string

const loading = ref(false)
const trace = ref<unknown[]>([])

async function fetchTrace() {
  loading.value = true
  try {
    trace.value = (await observabilityApi.sessionTrace(sessionId)) as unknown as unknown[]
  } finally {
    loading.value = false
  }
}

onMounted(fetchTrace)
</script>

<template>
  <div class="obs-session">
    <div class="header">
      <el-button text @click="router.push('/admin/observability')">← 返回看板</el-button>
      <span class="session-id" :title="sessionId">会话: {{ sessionId.slice(0, 12) }}{{ sessionId.length > 12 ? '…' : '' }}</span>
    </div>

    <div v-loading="loading">
      <TraceTimeline :exchanges="trace as any[]" />
    </div>
  </div>
</template>

<style scoped>
.obs-session { padding: 0; }
.header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.session-id {
  font-size: 14px;
  color: var(--sa-text-secondary);
  font-family: var(--sa-font-mono);
  word-break: break-all;
  min-width: 0;
}
</style>
