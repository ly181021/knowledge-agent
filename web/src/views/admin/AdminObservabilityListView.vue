<script setup lang="ts">
/**
 * AdminObservabilityListView —— 方案 3：KPI 统计卡 + 会话表格
 * 顶部 4 张带环比趋势的 KPI 卡（延迟下降=绿）+ 会话列表，
 * 耗时用迷你 bar 色阶（绿快/琥珀中/红慢），状态徽章色点+文字。
 */
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { observabilityApi, type SessionListRes, type MetricsData } from '@/api/observability'

const router = useRouter()
const sessions = ref<SessionListRes>({ page: 1, size: 20, total: 0, items: [] })
const metrics = ref<MetricsData>({ tokenTrend: [], topHitDocuments: [], modeDistribution: [] })

// 会话列表筛选
const filter = ref({ keyword: '', mode: '', dateRange: null as [Date, Date] | null })
const page = ref(1)
const size = ref(20)

// KPI 卡数据（从 metrics 派生 + 会话列表 total）
const kpi = computed(() => {
  const trend = metrics.value.tokenTrend ?? []
  const totalTokens = trend.reduce((s, d) => s + d.tokens, 0)
  const totalQps = trend.reduce((s, d) => s + d.qps, 0)
  const avgLatency = totalQps > 0 ? (totalTokens / totalQps) : 0
  // 检索模式占比
  const modes = metrics.value.modeDistribution ?? []
  const retrievalCount = modes.find((m) => m.mode === 'RETRIEVAL')?.count ?? 0
  const totalModeCount = modes.reduce((s, m) => s + m.count, 0) || 1
  const retrievalRate = Math.round((retrievalCount / totalModeCount) * 100)
  return {
    sessions: sessions.value.total,
    avgLatency: avgLatency.toFixed(1),
    totalTokens,
    retrievalRate,
  }
})

async function fetchSessions() {
  const res = (await observabilityApi.listSessions({
    page: page.value,
    size: size.value,
    keyword: filter.value.keyword || undefined,
    mode: filter.value.mode || undefined,
    dateFrom: filter.value.dateRange?.[0]?.toISOString(),
    dateTo: filter.value.dateRange?.[1]?.toISOString(),
  })) as unknown as SessionListRes
  sessions.value = res
}

async function fetchMetrics() {
  metrics.value = (await observabilityApi.getMetrics('7d')) as unknown as MetricsData
}

// 耗时色阶：绿快(<1.5s) / 琥珀中(1.5-3s) / 红慢(>3s)
function latencyMeta(ms: number | null): { cls: string; pct: number } {
  if (!ms) return { cls: 'lat-fill-mid', pct: 40 }
  const s = ms / 1000
  const pct = Math.min(100, Math.round((s / 4) * 100))
  const cls = s < 1.5 ? 'lat-fill-fast' : s > 3 ? 'lat-fill-slow' : 'lat-fill-mid'
  return { cls, pct }
}

// 模式徽章映射（色点+文字）
function modeClass(mode: string | null): string {
  if (mode === 'RETRIEVAL') return 'is-info'
  if (mode === 'REACT_AGENT') return 'is-neutral'
  if (mode === 'CLARIFICATION') return 'is-warn'
  return 'is-neutral'
}
function modeLabel(mode: string | null): string {
  if (mode === 'RETRIEVAL') return '检索'
  if (mode === 'REACT_AGENT') return '开放式'
  if (mode === 'CLARIFICATION') return '澄清'
  return mode ?? '-'
}

function openTrace(id: string) {
  router.push(`/admin/observability/${id}`)
}

function onFilter() {
  page.value = 1
  fetchSessions()
}

function onPageChange(p: number) {
  page.value = p
  fetchSessions()
}

onMounted(() => {
  fetchMetrics()
  fetchSessions()
})
</script>

<template>
  <div class="obs-list">
    <!-- KPI 统计卡 -->
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-name">总会话数</div>
        <div class="stat-val-row">
          <span class="stat-val">{{ kpi.sessions.toLocaleString() }}</span>
        </div>
        <div class="stat-ctx">近 7 天</div>
      </div>
      <div class="stat-card">
        <div class="stat-name">Token 消耗</div>
        <div class="stat-val-row">
          <span class="stat-val">{{ kpi.totalTokens >= 1000 ? Math.round(kpi.totalTokens / 1000) + 'K' : kpi.totalTokens }}</span>
        </div>
        <div class="stat-ctx">近 7 天累计</div>
      </div>
      <div class="stat-card">
        <div class="stat-name">检索命中率</div>
        <div class="stat-val-row">
          <span class="stat-val">{{ kpi.retrievalRate }}<span class="unit">%</span></span>
        </div>
        <div class="stat-ctx">RETRIEVAL 模式占比</div>
      </div>
      <div class="stat-card">
        <div class="stat-name">活跃会话</div>
        <div class="stat-val-row">
          <span class="stat-val">{{ sessions.items.length }}</span>
        </div>
        <div class="stat-ctx">当前页</div>
      </div>
    </div>

    <!-- 会话列表 -->
    <div class="list-header">
      <h3>对话观测</h3>
      <div class="filter-bar">
        <el-input v-model="filter.keyword" placeholder="🔍 搜索标题" clearable size="default" style="width: 200px" @keyup.enter="onFilter" />
        <el-select v-model="filter.mode" placeholder="全部模式" clearable size="default" style="width: 130px" @change="onFilter">
          <el-option label="检索" value="RETRIEVAL" />
          <el-option label="歧义澄清" value="CLARIFICATION" />
          <el-option label="开放式提问" value="REACT_AGENT" />
        </el-select>
        <el-date-picker v-model="filter.dateRange" type="daterange" size="default" range-separator="至" start-placeholder="开始" end-placeholder="结束" style="width: 240px" @change="onFilter" />
        <el-button size="default" type="primary" @click="onFilter">筛选</el-button>
      </div>
    </div>

    <el-table :data="sessions.items" class="obs-table" style="width: 100%">
      <el-table-column label="会话" min-width="200">
        <template #default="{ row }">
          <div class="dn-title">{{ row.title || '未命名会话' }}</div>
          <div class="dn-meta">{{ row.id?.slice(0, 12) }}...</div>
        </template>
      </el-table-column>
      <el-table-column prop="exchangeCount" label="交互" min-width="80" align="center" header-align="center" />
      <el-table-column label="最近模式" min-width="120" align="center" header-align="center">
        <template #default="{ row }">
          <span class="mode-badge" :class="modeClass(row.lastMode)">{{ modeLabel(row.lastMode) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="耗时" min-width="160" align="center" header-align="center">
        <template #default="{ row }">
          <div class="lat-cell">
            <div class="lat-bar">
              <div class="lat-fill" :class="latencyMeta(row.lastDurationMs).cls" :style="{ width: latencyMeta(row.lastDurationMs).pct + '%' }" />
            </div>
            <span class="lat-num">{{ row.lastDurationMs ? (row.lastDurationMs / 1000).toFixed(1) + 's' : '-' }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="更新时间" min-width="160" align="center" header-align="center">
        <template #default="{ row }">{{ new Date(row.updatedAt).toLocaleString() }}</template>
      </el-table-column>
      <el-table-column label="操作" min-width="120" fixed="right" align="center" header-align="center">
        <template #default="{ row }">
          <el-button text type="primary" size="small" @click="openTrace(row.id)">查看 Trace</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-if="sessions.total > 0"
      class="pagination"
      layout="total, prev, pager, next"
      :total="sessions.total"
      :page-size="size"
      :current-page="page"
      @current-change="onPageChange"
    />
  </div>
</template>

<style scoped>
.obs-list { padding: 0; }
.obs-list h3 { color: var(--sa-text-primary); font-size: 20px; font-weight: 600; margin: 0; }

/* ===== KPI 统计卡 ===== */
.stats-row {
  display: flex;
  gap: 16px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}
.stat-card {
  flex: 1;
  min-width: 160px;
  background: var(--sa-bg-card);
  border: 1px solid var(--sa-border);
  border-radius: var(--sa-radius-md);
  padding: 16px;
  box-shadow: var(--sa-shadow);
}
.stat-name { font-size: 12px; color: var(--sa-text-secondary); margin-bottom: 8px; }
.stat-val-row { display: flex; align-items: baseline; }
.stat-val {
  font-size: 26px;
  font-weight: 700;
  color: var(--sa-text-primary);
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.stat-val .unit { font-size: 14px; color: var(--sa-text-secondary); font-weight: 500; }
.stat-ctx { font-size: 11px; color: var(--sa-text-placeholder); margin-top: 4px; }

/* ===== 会话列表头 ===== */
.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
}
.filter-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.dn-title { font-weight: 500; color: var(--sa-text-primary); }
.dn-meta { font-size: 11px; color: var(--sa-text-placeholder); }

/* 模式徽章（色点+文字） */
.mode-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: var(--sa-radius-full);
  font-size: 12px;
  font-weight: 500;
}
.mode-badge::before {
  content: '';
  width: 6px; height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}
.is-info { background: #e8eef5; color: #4a6a8a; }
.is-neutral { background: var(--sa-bg-active); color: var(--sa-text-secondary); }
.is-warn { background: #fdf3e0; color: #a87515; }

/* 耗时迷你 bar */
.lat-cell { display: flex; align-items: center; gap: 8px; }
.lat-bar {
  width: 60px; height: 5px;
  background: var(--sa-bg-sidebar);
  border-radius: 3px;
  overflow: hidden;
  flex-shrink: 0;
}
.lat-fill { height: 100%; border-radius: 3px; }
.lat-fill-fast { background: #5a9a5a; }
.lat-fill-mid { background: #d4a020; }
.lat-fill-slow { background: #c4503a; }
.lat-num { font-size: 12px; color: var(--sa-text-secondary); font-variant-numeric: tabular-nums; }

/* 表格：圆角加大 + 白表头陶土下划线 + 字体稍大（与文档管理一致） */
.obs-table {
  border-radius: var(--sa-radius-lg);
  overflow: hidden;
}
.obs-table :deep(.el-table__inner-wrapper) {
  border: 1px solid var(--sa-border);
  border-radius: var(--sa-radius-lg);
  overflow: hidden;
}
.obs-table :deep(th.el-table__cell) {
  background: var(--sa-bg-card);
  color: var(--sa-text-secondary);
  font-weight: 600;
  font-size: 13px;
  border-bottom: 2px solid var(--sa-primary);
  padding: 13px 14px;
}
.obs-table :deep(td.el-table__cell) {
  border-bottom: 1px solid var(--sa-border-light);
  font-size: 14px;
  padding: 13px 14px;
}
.obs-table :deep(.el-table__row:hover > td) {
  background: var(--sa-bg-hover) !important;
}
.pagination { margin-top: 16px; justify-content: flex-end; }

@media (max-width: 768px) {
  .obs-list h3 { font-size: 18px; }
  .stat-card { min-width: 100%; }
}
</style>
