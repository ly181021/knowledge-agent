<script setup lang="ts">
/**
 * AdminDashboardView —— 运营总览
 * 3 张 ECharts 图 + 时间范围选择器 + 柱状钻取抽屉 + 顶部数字卡片（总文档数/已索引数/总会话数/近 7 天 Token）
 * 复用 observabilityApi.getMetrics + documentApi.list，不新建后端接口
 */
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  observabilityApi,
  type MetricsData,
  type DocumentSessionItem,
} from '@/api/observability'
import { documentApi } from '@/api/document'
import LineChart from '@/components/charts/LineChart.vue'
import BarChart from '@/components/charts/BarChart.vue'
import PieChart from '@/components/charts/PieChart.vue'

const router = useRouter()
const loading = ref(false)
const metrics = ref<MetricsData>({ tokenTrend: [], topHitDocuments: [], modeDistribution: [] })

// 时间范围选择器
const range = ref<'7d' | '30d' | 'all'>('7d')

// 顶部数字卡片
const totalDocs = ref(0)
const indexedDocs = ref(0)
const totalSessions = ref(0)
const tokens7d = ref(0)

// 钻取抽屉
const drawerVisible = ref(false)
const drawerDocTitle = ref('')
const drawerDocId = ref('')
const drawerSessions = ref<DocumentSessionItem[]>([])
const drawerLoading = ref(false)

async function fetchMetrics() {
  loading.value = true
  try {
    metrics.value = (await observabilityApi.getMetrics(range.value)) as unknown as MetricsData
    // 近 7 天 Token 总量（仅 7d 范围下与卡片语义一致）
    if (range.value === '7d') {
      tokens7d.value = metrics.value.tokenTrend.reduce((sum, d) => sum + d.tokens, 0)
    }
  } finally {
    loading.value = false
  }
}

async function fetchStats() {
  // 文档统计：total + indexed（两次轻量查询，只取 total 计数）
  const all = (await documentApi.list({ page: 1, size: 1 })) as unknown as { total: number }
  const indexed = (await documentApi.list({ page: 1, size: 1, status: 'INDEXED' })) as unknown as {
    total: number
  }
  totalDocs.value = all.total ?? 0
  indexedDocs.value = indexed.total ?? 0
  // 会话总数：复用 observability 会话列表的 total（拉一条拿计数）
  const sess = (await observabilityApi.listSessions({ page: 1, size: 1 })) as unknown as {
    total: number
  }
  totalSessions.value = sess.total ?? 0
}

async function onBarClick(payload: { docId: string; docTitle: string }) {
  drawerDocId.value = payload.docId
  drawerDocTitle.value = payload.docTitle
  drawerVisible.value = true
  drawerLoading.value = true
  try {
    drawerSessions.value = (await observabilityApi.documentSessions(payload.docId)) as unknown as DocumentSessionItem[]
  } finally {
    drawerLoading.value = false
  }
}

function openTrace(id: string) {
  router.push(`/admin/observability/${id}`)
}

function onRangeChange() {
  fetchMetrics()
}

onMounted(() => {
  fetchMetrics()
  fetchStats()
})
</script>

<template>
  <div class="dashboard">
    <div class="page-header">
      <h3>运营总览</h3>
      <el-radio-group v-model="range" size="small" @change="onRangeChange">
        <el-radio-button value="7d">近 7 天</el-radio-button>
        <el-radio-button value="30d">近 30 天</el-radio-button>
        <el-radio-button value="all">全部</el-radio-button>
      </el-radio-group>
    </div>

    <!-- 数字卡片 -->
    <div class="stats-row">
      <el-card class="stat-card">
        <div class="stat-value">{{ totalDocs }}</div>
        <div class="stat-label">文档总数</div>
      </el-card>
      <el-card class="stat-card">
        <div class="stat-value">{{ indexedDocs }}</div>
        <div class="stat-label">已索引文档</div>
      </el-card>
      <el-card class="stat-card">
        <div class="stat-value">{{ totalSessions }}</div>
        <div class="stat-label">会话总数</div>
      </el-card>
      <el-card class="stat-card">
        <div class="stat-value">{{ tokens7d.toLocaleString() }}</div>
        <div class="stat-label">近 7 天 Token</div>
      </el-card>
    </div>

    <!-- 图表区 -->
    <div v-loading="loading" class="charts-row">
      <el-card class="chart-card">
        <template #header>Token / QPS 趋势</template>
        <LineChart :data="metrics.tokenTrend" />
      </el-card>
      <el-card class="chart-card">
        <template #header>检索命中 Top10（点击钻取）</template>
        <BarChart :data="metrics.topHitDocuments" @click="onBarClick" />
      </el-card>
      <el-card class="chart-card">
        <template #header>执行模式占比</template>
        <PieChart :data="metrics.modeDistribution" />
      </el-card>
    </div>

    <!-- 钻取抽屉 -->
    <el-drawer v-model="drawerVisible" :title="`文档「${drawerDocTitle}」命中会话`" size="420px">
      <div v-loading="drawerLoading">
        <div v-if="drawerSessions.length === 0 && !drawerLoading" class="drawer-empty">
          该文档暂无命中会话
        </div>
        <div v-for="s in drawerSessions" :key="s.id" class="drawer-item" @click="openTrace(s.id)">
          <div class="drawer-item-title">{{ s.title || '未命名会话' }}</div>
          <div class="drawer-item-meta">
            <span>命中 {{ s.hitCount }} 次</span>
            <span>{{ new Date(s.updatedAt).toLocaleString() }}</span>
          </div>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.dashboard h3 {
  color: var(--sa-text-primary);
  font-size: 20px;
  font-weight: 600;
  margin: 0;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
}

/* 数字卡片 */
.stats-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 24px;
}
.stat-card {
  flex: 1;
  min-width: 180px;
  border-radius: var(--sa-radius-md);
  border: 1px solid var(--sa-border);
  background: var(--sa-bg-card);
  box-shadow: var(--sa-shadow);
  text-align: center;
  padding: 8px 0;
}
.stat-card :deep(.el-card__body) { padding: 20px; }
.stat-value {
  font-size: 32px;
  font-weight: 600;
  color: var(--sa-primary);
  line-height: 1.2;
}
.stat-label {
  font-size: 13px;
  color: var(--sa-text-secondary);
  margin-top: 6px;
}

/* 图表区（方案 B） */
.charts-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
.chart-card {
  flex: 1;
  min-width: 360px;
  border-radius: var(--sa-radius-md);
  border: 1px solid var(--sa-border);
  background: var(--sa-bg-card);
  box-shadow: var(--sa-shadow);
}
.chart-card :deep(.el-card__header) {
  background: var(--sa-bg-card);
  font-weight: 600;
  color: var(--sa-text-primary);
  border-bottom: 2px solid var(--sa-primary);
  padding: 12px 16px;
}

/* 钻取抽屉 */
.drawer-item {
  padding: 12px;
  border: 1px solid var(--sa-border);
  border-radius: var(--sa-radius-sm);
  margin-bottom: 8px;
  cursor: pointer;
  transition: var(--sa-transition);
}
.drawer-item:hover {
  border-color: var(--sa-primary);
  background: var(--sa-bg-hover);
}
.drawer-item-title {
  font-size: 14px;
  color: var(--sa-text-primary);
  font-weight: 500;
  margin-bottom: 4px;
}
.drawer-item-meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--sa-text-secondary);
}
.drawer-empty {
  text-align: center;
  color: var(--sa-text-secondary);
  padding: 24px;
}

@media (max-width: 768px) {
  .stat-card { min-width: 100%; }
  .chart-card { min-width: 100%; }
  .dashboard h3 { font-size: 18px; }
}
</style>
