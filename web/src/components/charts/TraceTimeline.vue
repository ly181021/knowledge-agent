<script setup lang="ts">
/**
 * TraceTimeline —— trace 时间线
 * 渲染 ChatExchange → ChannelExecution / RetrievalResult / ChatModelUsageTrace
 */
import StepTimeline from '@/components/StepTimeline.vue'
import RetrievalFunnel from '@/components/RetrievalFunnel.vue'
import { traceStagesToThinkingSteps } from '@/utils/trace-transform'

interface TraceExchange {
  id: string
  question: string
  answer: string
  executionMode: string
  durationMs: number | null
  channelExecutions: { channel: string; recalled: number; accepted: number; durationMs: number | null }[]
  modelUsageTraces: { model: string; promptTokens: number; completionTokens: number; totalTokens: number; durationMs: number | null }[]
  retrievalResults: { docId: string | null; chunkId: string | null; vectorScore: number | null; keywordScore: number | null; rrfScore: number | null; accepted: boolean; rank: number | null }[]
  traceStages: { stage: string; state: string; output: unknown; startedAt: string; durationMs: number | null }[]
}

defineProps<{ exchanges: TraceExchange[] }>()
</script>

<template>
  <div class="trace-timeline">
    <div v-if="exchanges.length === 0" class="empty">暂无 trace 数据</div>
    <div v-for="ex in exchanges" :key="ex.id" class="exchange">
      <div class="ex-header">
        <el-tag size="small" :type="ex.executionMode === 'RETRIEVAL' ? 'success' : 'warning'">{{ ex.executionMode }}</el-tag>
        <span class="question">{{ ex.question.slice(0, 60) }}</span>
        <span class="duration">{{ ex.durationMs ? (ex.durationMs / 1000).toFixed(1) + 's' : '-' }}</span>
      </div>

      <div class="ex-body">
        <!-- 责任链步骤：从 traceStages 渲染，复用 StepTimeline + RetrievalFunnel -->
        <div v-if="ex.traceStages && ex.traceStages.length" class="section">
          <div class="section-title">责任链步骤</div>
          <StepTimeline :steps="traceStagesToThinkingSteps(ex.traceStages)" />
          <RetrievalFunnel :steps="traceStagesToThinkingSteps(ex.traceStages)" />
        </div>

        <!-- 通道执行 -->
        <div v-if="ex.channelExecutions.length" class="section">
          <div class="section-title">检索通道</div>
          <div v-for="ch in ex.channelExecutions" :key="ch.channel" class="channel-row">
            <span class="channel-name">{{ ch.channel }}</span>
            <span>召回 {{ ch.recalled }} / 入选 {{ ch.accepted }}</span>
            <span class="muted">{{ ch.durationMs ? ch.durationMs + 'ms' : '-' }}</span>
          </div>
        </div>

        <!-- 检索结果 -->
        <div v-if="ex.retrievalResults.length" class="section">
          <div class="section-title">检索结果（{{ ex.retrievalResults.length }} 条）</div>
          <el-table :data="ex.retrievalResults" size="small" border style="width: 100%">
            <el-table-column prop="rank" label="排名" width="60" />
            <el-table-column prop="vectorScore" label="向量分" width="90">
              <template #default="{ row }">{{ row.vectorScore ? row.vectorScore.toFixed(4) : '-' }}</template>
            </el-table-column>
            <el-table-column prop="keywordScore" label="关键词分" width="90">
              <template #default="{ row }">{{ row.keywordScore ? row.keywordScore.toFixed(4) : '-' }}</template>
            </el-table-column>
            <el-table-column prop="rrfScore" label="RRF 分" width="90">
              <template #default="{ row }">{{ row.rrfScore ? row.rrfScore.toFixed(4) : '-' }}</template>
            </el-table-column>
            <el-table-column label="入选" width="60">
              <template #default="{ row }">
                <el-tag :type="row.accepted ? 'success' : 'info'" size="small">{{ row.accepted ? '是' : '否' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="docId" label="文档" min-width="120" show-overflow-tooltip />
          </el-table>
        </div>

        <!-- Token 用量 -->
        <div v-if="ex.modelUsageTraces.length" class="section">
          <el-descriptions :column="5" size="small" border>
            <template #title>
              <span class="section-title-inline">Token 用量</span>
            </template>
            <el-descriptions-item label="模型">{{ ex.modelUsageTraces[0]?.model }}</el-descriptions-item>
            <el-descriptions-item label="输入 (Prompt)">
              <span class="num">{{ ex.modelUsageTraces[0]?.promptTokens }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="输出 (Completion)">
              <span class="num">{{ ex.modelUsageTraces[0]?.completionTokens }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="总计 (Total)">
              <span class="num num-total">{{ ex.modelUsageTraces[0]?.totalTokens }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="耗时">
              <span class="muted">{{ ex.modelUsageTraces[0]?.durationMs ? (ex.modelUsageTraces[0].durationMs / 1000).toFixed(1) + 's' : '-' }}</span>
            </el-descriptions-item>
          </el-descriptions>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.trace-timeline { padding: 0; }
.empty { text-align: center; color: var(--sa-text-secondary); padding: 40px 0; }

.exchange {
  margin-bottom: 20px;
  border: 1px solid var(--sa-border);
  border-radius: var(--sa-radius-md);
  overflow: hidden;
  background: var(--sa-bg-card);
  transition: var(--sa-transition);
}
.exchange:hover { box-shadow: var(--sa-shadow); }

.ex-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--sa-bg-sidebar);
  border-bottom: 1px solid var(--sa-border);
}
.question { flex: 1; font-size: 14px; color: var(--sa-text-primary); font-weight: 500; }
.duration { font-size: 12px; color: var(--sa-text-secondary); }

.ex-body { padding: 16px; }
.section { margin-bottom: 16px; }
.section:last-child { margin-bottom: 0; }
.section-title {
  font-size: 12px;
  color: var(--sa-text-secondary);
  margin-bottom: 8px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.section-title-inline { font-size: 13px; color: var(--sa-text-regular); font-weight: 600; }
.channel-row { display: flex; gap: 16px; font-size: 13px; color: var(--sa-text-regular); padding: 4px 0; }
.channel-name { font-weight: 600; min-width: 70px; color: var(--sa-text-primary); }
.usage-row { display: flex; gap: 16px; font-size: 13px; color: var(--sa-text-regular); padding: 2px 0; }
.muted { color: var(--sa-text-secondary); }
.num { color: var(--sa-primary); font-weight: 600; }
.num-total { color: var(--sa-primary-pressed); font-weight: 700; }

/* 表格风格统一 */
.exchange :deep(.el-table) { border-radius: var(--sa-radius-sm); overflow: hidden; }
.exchange :deep(th.el-table__cell) { background: var(--sa-bg-sidebar); color: var(--sa-text-primary); }
.exchange :deep(.el-descriptions__label) { background: var(--sa-bg-sidebar); color: var(--sa-text-secondary); }
</style>
