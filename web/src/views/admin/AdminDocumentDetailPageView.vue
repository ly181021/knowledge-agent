<script setup lang="ts">
/**
 * AdminDocumentDetailPageView —— 文档详情全页（五段式）
 * 五段式 Tab：概览 / 配置策略 / 确认并构建 / 验证 Chunk / 任务记录
 * 路由：/admin/documents/:id
 * 数据：overview + taskLogs（时间线 + 进度轮询）+ reindex
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { documentApi, type DocOverview, type TaskLogItem, type RecommendConfig, type SavedConfig, type ChunkItem, type ChunkStrategy } from '@/api/document'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge.vue'
import FileTypeIcon from '@/components/admin/FileTypeIcon.vue'

const route = useRoute()
const router = useRouter()
const docId = route.params.id as string

const activeTab = ref('overview')
const loading = ref(false)
const overview = ref<DocOverview | null>(null)
const taskLogs = ref<TaskLogItem[]>([])

// ===== 01 配置策略 =====
const recommend = ref<RecommendConfig | null>(null)
const savedConfig = ref<SavedConfig | null>(null)
const savingConfig = ref(false)
/** config 数据过期标记（重建后置 true，下次切 Tab 时重新拉取） */
const configStale = ref(false)

/** 当前编辑的流水线（有序策略数组，点击策略追加到末尾） */
const pipeline = ref<ChunkStrategy[]>([])
/** 切块参数 */
const chunkParams = ref({ chunkSize: 800, overlap: 120, semanticThreshold: 0.6 })

const STRATEGY_LABELS: Record<ChunkStrategy, string> = {
  STRUCTURE: '结构切块',
  RECURSIVE: '递归分块',
  SEMANTIC: '语义分块',
  LLM: 'LLM 智能切块',
}
const ALL_STRATEGIES = Object.keys(STRATEGY_LABELS) as ChunkStrategy[]

/** 点击策略 → 追加到流水线末尾（先点在前、后点在后） */
function addToPipeline(strategy: ChunkStrategy) {
  pipeline.value.push(strategy)
}
/** 移除流水线中某一步 */
function removeFromPipeline(idx: number) {
  pipeline.value.splice(idx, 1)
}
/** 流水线是否合法：至少一个生产型（STRUCTURE/RECURSIVE） */
const pipelineValid = computed(() => pipeline.value.some((s) => s === 'STRUCTURE' || s === 'RECURSIVE'))
/** 已删除留痕文档：写操作无意义（正文已清、reindex 被后端拒绝），隐藏入口 */
const softDeleted = computed(() => overview.value?.status === 'SOFT_DELETED')

/** diff：推荐 pipeline vs 当前编辑 pipeline 的不一致 */
const configDiff = computed(() => {
  if (!recommend.value) return []
  const diffs: { field: string; oldVal: string; newVal: string }[] = []
  const recPipe = recommend.value.pipeline.join(' → ')
  const curPipe = pipeline.value.join(' → ')
  if (recPipe !== curPipe) diffs.push({ field: '流水线', oldVal: recPipe, newVal: curPipe })
  if (recommend.value.chunkSize !== chunkParams.value.chunkSize) diffs.push({ field: '切块大小', oldVal: String(recommend.value.chunkSize), newVal: String(chunkParams.value.chunkSize) })
  if (recommend.value.overlap !== chunkParams.value.overlap) diffs.push({ field: '重叠', oldVal: String(recommend.value.overlap), newVal: String(chunkParams.value.overlap) })
  return diffs
})

// ===== 03 chunk 预览 =====
const chunks = ref<ChunkItem[]>([])
const chunkView = ref<'table' | 'tree'>('table')
const chunkSearch = ref('')
/** 当前展开查看完整内容的 chunk index（null=无展开） */
const expandedChunk = ref<number | null>(null)
/** chunks 数据过期标记（重建后置 true，下次切 Tab 时重新拉取） */
const chunksStale = ref(false)

/** 块大小统计（切换策略后块数/大小分布变化一目了然） */
const chunkStats = computed(() => {
  if (chunks.value.length === 0) return { count: 0, avg: 0, max: 0, min: 0, withPath: 0 }
  const sizes = chunks.value.map((c) => c.charCount)
  const avg = Math.round(sizes.reduce((s, n) => s + n, 0) / sizes.length)
  const withPath = chunks.value.filter((c) => c.headingPath.length > 0).length
  return {
    count: chunks.value.length,
    avg,
    max: Math.max(...sizes),
    min: Math.min(...sizes),
    withPath,
  }
})

/** 章节树：按 headingPath 聚合 chunks */
const chunkTree = computed(() => {
  const tree: { path: string; count: number; children: ChunkItem[] }[] = []
  for (const c of chunks.value) {
    const key = c.headingPath.length ? c.headingPath.join(' / ') : '（无标题）'
    let node = tree.find((t) => t.path === key)
    if (!node) {
      node = { path: key, count: 0, children: [] }
      tree.push(node)
    }
    node.children.push(c)
    node.count++
  }
  return tree
})

/** 章节树 el-tree 数据：单层——每章一个节点，标题 + 该章全部 chunk 渲染在同一节点行内
 *  （字段名 chunks 而非 children，避免 el-tree 把内容拆成独立子节点行） */
const chunkTreeData = computed(() =>
  chunkTree.value.map((t) => ({
    id: `section:${t.path}`,
    label: t.path,
    count: t.count,
    chunks: t.children.map((c) => ({
      id: c.id,
      // preview 由后端 content.slice(0,100) 实时生成，空 content 时为 ''，兜底避免 leaf 行空文本
      label: c.preview || '（空块）',
      chunkIndex: c.chunkIndex,
      charCount: c.charCount,
    })),
  })),
)

/** 搜索过滤后的 chunks（平铺表用） */
const filteredChunks = computed(() => {
  if (!chunkSearch.value) return chunks.value
  const kw = chunkSearch.value.toLowerCase()
  return chunks.value.filter((c) => c.content.toLowerCase().includes(kw))
})

/** 点击行展开/收起完整内容（el-table row-click 传入 row） */
function toggleChunk(row: ChunkItem) {
  expandedChunk.value = expandedChunk.value === row.chunkIndex ? null : row.chunkIndex
}

/** el-table 展开图标点击：同步到 expandedChunk（expandedChunk 为唯一事实源）
 *  箭头按钮已被 CSS 隐藏（行点击承担展开/收起），此事件几乎不再触发，保留作防御性同步。
 *  ep 的 expand-change 有两个重载签名 (row, expandedRows[]) 与 (row, expanded: boolean)，
 *  用 unknown 收敛避开重载联合的类型冲突，运行时按数组长度判断 */
function onExpandChange(row: ChunkItem, expanded: unknown) {
  const isOpen = Array.isArray(expanded) ? expanded.some((r) => r.id === row.id) : Boolean(expanded)
  expandedChunk.value = isOpen ? row.chunkIndex : null
}

/** el-table 受控展开 keys（基于 row id，派生自 expandedChunk） */
const expandedRowKeys = computed(() => {
  if (expandedChunk.value === null) return []
  const row = filteredChunks.value.find((c) => c.chunkIndex === expandedChunk.value)
  return row ? [row.id] : []
})

// ===== 02 构建进度轮询 =====
let pollTimer: ReturnType<typeof setInterval> | null = null

// ：PARSING（首次上传解析）也展示进度（原只认 INDEXING，首上传时进度区不显示）
const isBuilding = computed(() => {
  const s = overview.value?.status
  return s === 'INDEXING' || s === 'PARSING'
})

/** 进度百分比：取最新一条 RUNNING 的 percent，否则取最后一条 SUCCESS 累计，否则 0 */
const progressPercent = computed(() => {
  const running = taskLogs.value.find((l) => l.status === 'RUNNING')
  if (running?.percent != null) return running.percent
  // 无 RUNNING：取最后一条的 percent（已完成的阶段累计值）
  const last = taskLogs.value[taskLogs.value.length - 1]
  return last?.percent ?? 0
})

/** 阶段步进定义（按后端实际执行顺序：VECTORIZE → PARENT_BLOCK） */
const STAGES = [
  { key: 'PARSE', label: '解析' },
  { key: 'CHUNK', label: '切块' },
  { key: 'VECTORIZE', label: '向量化' },
  { key: 'PARENT_BLOCK', label: '父子块' },
  { key: 'KEYWORD_INDEX', label: '关键词' },
] as const

/** 每个阶段的状态：done / active / pending */
function stageState(stageKey: string): 'done' | 'active' | 'pending' {
  const logs = taskLogs.value.filter((l) => l.stage === stageKey)
  if (logs.some((l) => l.status === 'SUCCESS')) return 'done'
  if (logs.some((l) => l.status === 'RUNNING')) return 'active'
  return 'pending'
}

// ===== 数据加载 =====
async function fetchOverview() {
  overview.value = (await documentApi.overview(docId)) as unknown as DocOverview
}

async function fetchTaskLogs() {
  taskLogs.value = (await documentApi.taskLogs(docId)) as unknown as TaskLogItem[]
}

async function loadAll() {
  loading.value = true
  try {
    await Promise.all([fetchOverview(), fetchTaskLogs()])
  } finally {
    loading.value = false
  }
}

// ===== 01 配置加载与保存 =====
async function fetchConfig() {
  const [rec, saved] = await Promise.all([
    documentApi.configRecommend(docId) as unknown as Promise<RecommendConfig>,
    documentApi.config(docId) as unknown as Promise<SavedConfig | null>,
  ])
  recommend.value = rec
  savedConfig.value = saved
  // 初始化：优先用已存配置，否则用推荐值
  pipeline.value = saved?.pipeline?.length ? [...saved.pipeline] : [...rec.pipeline]
  chunkParams.value = {
    chunkSize: saved?.chunkSize ?? rec.chunkSize,
    overlap: saved?.overlap ?? rec.overlap,
    semanticThreshold: saved?.semanticThreshold ?? rec.semanticThreshold,
  }
}

/** 重置流水线为推荐值 */
function resetToRecommend() {
  if (!recommend.value) return
  pipeline.value = [...recommend.value.pipeline]
  chunkParams.value = {
    chunkSize: recommend.value.chunkSize,
    overlap: recommend.value.overlap,
    semanticThreshold: recommend.value.semanticThreshold,
  }
}

async function onSaveConfig() {
  if (!pipelineValid.value) {
    ElMessage.warning('流水线至少需要一个生产型策略（结构切块 / 递归分块）')
    return
  }
  savingConfig.value = true
  try {
    savedConfig.value = (await documentApi.saveConfig(docId, {
      pipeline: pipeline.value,
      ...chunkParams.value,
    })) as unknown as SavedConfig
    ElMessage.success('配置已保存，可在「确认并构建」中应用')
  } catch {
    // 拦截器已提示
  } finally {
    savingConfig.value = false
  }
}

// ===== 03 chunk 加载 =====
async function fetchChunks() {
  chunks.value = (await documentApi.chunks(docId)) as unknown as ChunkItem[]
}

/** 启动轮询（构建中时） */
function startPolling() {
  stopPolling()
  pollTimer = setInterval(async () => {
    await Promise.all([fetchOverview(), fetchTaskLogs()])
    // 终态停止轮询 + 标记 chunks/config 过期（重建后数据已变，下次切 Tab 时重新拉取）
    if (overview.value && overview.value.status !== 'INDEXING' && overview.value.status !== 'PARSING') {
      stopPolling()
      chunksStale.value = true
      configStale.value = true
    }
  }, 1500)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

// ===== 操作 =====
async function onReindex() {
  try {
    await ElMessageBox.confirm('重建将清空现有 chunks 和向量并重新生成，期间该文档检索会受影响。确认继续？', '重新索引', {
      type: 'warning',
      confirmButtonText: '确认重建',
      cancelButtonText: '取消',
    })
  } catch {
    return // 用户取消
  }
  try {
    overview.value = (await documentApi.reindex(docId)) as unknown as DocOverview
    ElMessage.success('已触发重建，正在处理…')
    activeTab.value = 'build'
    startPolling()
  } catch {
    // 拦截器已提示
  }
}

async function onDelete() {
  try {
    await ElMessageBox.confirm('删除后文档将不可检索，此操作不可撤销。', '删除文档', {
      type: 'error',
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await documentApi.remove(docId)
    ElMessage.success('文档已删除')
    router.push('/admin/documents')
  } catch {
    // 拦截器已提示
  }
}

// ===== 格式化工具 =====
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

function formatDuration(ms?: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function stageLabel(stage: string): string {
  return STAGES.find((s) => s.key === stage)?.label ?? stage
}

function timelineDotType(status: string): 'success' | 'primary' | 'danger' {
  if (status === 'SUCCESS') return 'success'
  if (status === 'RUNNING') return 'primary'
  return 'danger'
}

// 平均块长
const avgChunkLen = computed(() => {
  if (!overview.value?.charCount || !overview.value?.chunkCount) return '—'
  return Math.round(overview.value.charCount / overview.value.chunkCount).toLocaleString()
})

/** Tab 切换：切到 chunks/config 时按需加载（重建后 stale 标记触发重新拉取） */
async function onTabChange(name: string | number) {
  if (name === 'config' && (!recommend.value || configStale.value)) {
    await fetchConfig()
    configStale.value = false
  } else if (name === 'chunks' && (chunks.value.length === 0 || chunksStale.value)) {
    await fetchChunks()
    chunksStale.value = false
  }
}

onMounted(async () => {
  await loadAll()
  // 进入页面时若正在构建，自动开始轮询
  if (isBuilding.value) startPolling()
})

onBeforeUnmount(stopPolling)
</script>

<template>
  <div v-loading="loading" class="doc-page">
    <!-- 顶部 Header -->
    <div class="doc-header">
      <span class="back-link" @click="router.push('/admin/documents')">← 返回文档管理</span>
      <div class="doc-id">
        <FileTypeIcon :file-type="overview?.fileType ?? ''" />
        <div class="doc-id-text">
          <div class="doc-title">{{ overview?.title ?? '加载中…' }}</div>
          <div class="doc-file">
            {{ overview?.fileName }} · {{ overview ? formatSize(overview.fileSize) : '' }} · #{{ docId.slice(0, 8) }}
          </div>
        </div>
      </div>
      <AdminStatusBadge v-if="overview" :status="overview.status" :parse-stage="overview.parseStage" :error-msg="overview.errorMsg" />
      <div class="header-actions">
        <button v-if="!softDeleted" class="btn btn-danger" @click="onDelete">🗑 删除</button>
      </div>
    </div>

    <!-- Tab 区 -->
    <el-tabs v-model="activeTab" class="doc-tabs" @tab-change="onTabChange">
      <!-- 00 文档概览 -->
      <el-tab-pane label="00 文档概览" name="overview">
        <div v-if="overview" class="tab-panel">
          <!-- KPI 卡片 -->
          <div class="kpi-row">
            <div class="kpi-card">
              <div class="kpi-name">字符数</div>
              <div class="kpi-val">{{ (overview.charCount ?? 0).toLocaleString() }}</div>
              <div class="kpi-ctx">解析后纯文本</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-name">Token 数</div>
              <div class="kpi-val">{{ (overview.tokenCount ?? 0).toLocaleString() }}</div>
              <div class="kpi-ctx">粗估值</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-name">分块数</div>
              <div class="kpi-val">{{ overview.chunkCount }}</div>
              <div class="kpi-ctx">切块产出</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-name">平均块长</div>
              <div class="kpi-val">{{ avgChunkLen }}<span class="kpi-unit"> 字</span></div>
              <div class="kpi-ctx">字符 / 块</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-name">文档质量</div>
              <div class="kpi-val">{{ overview.quality ?? '—' }}</div>
              <div class="kpi-ctx">GOOD / LOW</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-name">总耗时</div>
              <div class="kpi-val">{{ overview.totalDurationMs ? (overview.totalDurationMs / 1000).toFixed(1) : '—' }}<span class="kpi-unit"> s</span></div>
              <div class="kpi-ctx">上次构建</div>
            </div>
          </div>

          <!-- 元信息 -->
          <el-descriptions :column="2" border class="meta-grid">
            <el-descriptions-item label="文档 ID"><code>{{ overview.id }}</code></el-descriptions-item>
            <el-descriptions-item label="文件类型">{{ overview.fileType }}</el-descriptions-item>
            <el-descriptions-item label="业务分类">{{ overview.businessType ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="标签">{{ overview.tags?.length ? overview.tags.join('、') : '—' }}</el-descriptions-item>
            <el-descriptions-item label="存储路径"><code>{{ overview.fileUrl }}</code></el-descriptions-item>
            <el-descriptions-item label="知识域">{{ overview.scopeId ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="创建时间">{{ formatTime(overview.createdAt) }}</el-descriptions-item>
            <el-descriptions-item label="更新时间">{{ formatTime(overview.updatedAt) }}</el-descriptions-item>
          </el-descriptions>
        </div>
      </el-tab-pane>

      <!-- 01 配置策略 -->
      <el-tab-pane label="01 配置策略" name="config">
        <div v-loading="!recommend" class="tab-panel">
          <!-- diff 提示条 -->
          <div v-if="configDiff.length" class="diff-banner">
            <span class="diff-title">推荐值与当前配置不一致：</span>
            <span v-for="d in configDiff" :key="d.field" class="diff-item">
              {{ d.field }}：<del>{{ d.oldVal }}</del>→<ins>{{ d.newVal }}</ins>
            </span>
          </div>

          <!-- 推荐流水线提示（轻量，融入顶部） -->
          <div v-if="recommend" class="rec-hint-bar">
            <span class="rec-hint-label">系统推荐：</span>
            <span class="rec-hint-pipeline">{{ recommend.pipeline.map(s => STRATEGY_LABELS[s]).join(' → ') }}</span>
            <span class="rec-hint-reason">💡 {{ recommend.reason }}</span>
            <button class="btn btn-sm" @click="resetToRecommend">采用推荐</button>
          </div>

          <div class="config-col manual">
            <div class="config-col-head">
              <span class="config-col-title">流水线组装</span>
              <span v-if="savedConfig?.source === 'MANUAL'" class="config-tag manual">手动</span>
            </div>
            <div class="config-body">
              <!-- 可选策略：点击追加到流水线末尾 -->
              <div class="strategy-picker">
                <span class="form-label">点击策略添加</span>
                <div class="strategy-buttons">
                  <button
                    v-for="s in ALL_STRATEGIES"
                    :key="s"
                    class="strategy-btn"
                    @click="addToPipeline(s)"
                  >
                    + {{ STRATEGY_LABELS[s] }}
                  </button>
                </div>
                <p class="strategy-hint">生产型（结构/递归）从原文产出块，转换型（语义/LLM）精修边界</p>
              </div>

              <!-- 已组装流水线（有序，可删除） -->
              <div class="pipeline-editor">
                <span class="form-label">最终提交顺序</span>
                <div v-if="pipeline.length" class="pipeline-list">
                  <div v-for="(s, i) in pipeline" :key="i" class="pipeline-step-edit">
                    <span class="step-num">{{ i + 1 }}</span>
                    <span class="step-label">{{ STRATEGY_LABELS[s] }}</span>
                    <span class="step-role">{{ s === 'STRUCTURE' || s === 'RECURSIVE' ? '生产型' : '转换型' }}</span>
                    <button class="step-remove" @click="removeFromPipeline(i)">✕</button>
                  </div>
                </div>
                <div v-else class="pipeline-empty">流水线为空，点击上方策略添加</div>
                <p v-if="!pipelineValid && pipeline.length" class="pipeline-warn">⚠ 流水线至少需要一个生产型策略（结构切块 / 递归分块）</p>
              </div>

              <!-- 参数 -->
              <div class="form-row-pair">
                <div class="form-row half">
                  <span class="form-label">切块大小</span>
                  <input v-model.number="chunkParams.chunkSize" type="number" class="form-input" />
                </div>
                <div class="form-row half">
                  <span class="form-label">重叠</span>
                  <input v-model.number="chunkParams.overlap" type="number" class="form-input" />
                </div>
              </div>

              <div class="config-actions">
                <button v-if="!softDeleted" class="btn" @click="resetToRecommend">重置为推荐值</button>
                <button v-if="!softDeleted" class="btn btn-primary" :disabled="!pipelineValid" @click="onSaveConfig">
                  {{ savingConfig ? '保存中…' : '保存配置' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <!-- 02 确认并构建 -->
      <el-tab-pane label="02 确认并构建" name="build">
        <div class="tab-panel">
          <!-- 构建中态（PARSING 首次上传 / INDEXING 重建索引都显示进度） -->
          <div v-if="isBuilding" class="build-area">
            <div class="build-top">
              <!-- 文案按 status 分支，不能硬编码"重建索引" -->
              <span class="build-status-text">{{ overview?.status === 'PARSING' ? '正在解析文档…' : '正在重建索引…' }}</span>
              <AdminStatusBadge :status="overview!.status" :parse-stage="overview?.parseStage" />
            </div>
            <!-- 进度条 -->
            <div class="progress-track">
              <div class="progress-fill" :style="{ width: progressPercent + '%' }" />
            </div>
            <div class="progress-meta">
              <span>当前进度</span>
              <span>{{ progressPercent }}%</span>
            </div>
            <!-- 阶段步进 -->
            <div class="stage-steps">
              <div v-for="stage in STAGES" :key="stage.key" :class="['stage-step', stageState(stage.key)]">
                <div class="stage-dot" />
                <div class="stage-label">{{ stage.label }}</div>
              </div>
            </div>
          </div>

          <!-- 空闲态 -->
          <div v-else class="build-area build-idle">
            <div class="build-empty">
              <div class="build-icon">{{ overview?.status === 'FAILED' ? '⚠' : '✓' }}</div>
              <p v-if="overview?.status === 'FAILED'" class="build-empty-text">
                上次构建失败。可重新尝试构建。
              </p>
              <p v-else class="build-empty-text">
                当前索引已是最新（{{ overview ? formatTime(overview.updatedAt) : '' }} 构建）。
              </p>
              <button v-if="!softDeleted" class="btn btn-primary" @click="onReindex">确认并重新构建</button>
              <p class="build-hint">重建会先清旧 chunk + 向量再重跑，期间该文档检索会受影响</p>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <!-- 03 验证 Chunk -->
      <el-tab-pane label="03 验证 Chunk" name="chunks">
        <div class="tab-panel">
          <!-- 块大小统计卡（切换策略后块数/大小变化一目了然） -->
          <div v-if="chunks.length" class="chunk-stats">
            <div class="stat-card">
              <div class="stat-num">{{ chunkStats.count }}</div>
              <div class="stat-label">总块数</div>
            </div>
            <div class="stat-card">
              <div class="stat-num">{{ chunkStats.avg.toLocaleString() }}</div>
              <div class="stat-label">平均字数</div>
            </div>
            <div class="stat-card">
              <div class="stat-num">{{ chunkStats.max.toLocaleString() }}</div>
              <div class="stat-label">最大块</div>
            </div>
            <div class="stat-card">
              <div class="stat-num">{{ chunkStats.min.toLocaleString() }}</div>
              <div class="stat-label">最小块</div>
            </div>
            <div class="stat-card">
              <div class="stat-num">{{ chunkStats.withPath }}/{{ chunkStats.count }}</div>
              <div class="stat-label">含章节路径</div>
            </div>
          </div>

          <!-- 工具栏 -->
          <div class="chunk-toolbar">
            <div class="view-toggle">
              <button :class="{ active: chunkView === 'table' }" @click="chunkView = 'table'">≡ 平铺列表</button>
              <button :class="{ active: chunkView === 'tree' }" @click="chunkView = 'tree'">CFG 章节树</button>
            </div>
            <input v-if="chunkView === 'table'" v-model="chunkSearch" class="chunk-search" placeholder="🔍 在块内容中搜索" />
            <span class="chunk-spacer" />
          </div>

          <!-- 平铺表格视图（行点击展开完整内容） -->
          <el-table
            v-if="chunkView === 'table'"
            :data="filteredChunks"
            class="chunk-el-table"
            row-key="id"
            :expand-row-keys="expandedRowKeys"
            :row-class-name="({ row }) => expandedChunk === row.chunkIndex ? 'chunk-row-expanded' : ''"
            @row-click="toggleChunk"
            @expand-change="onExpandChange"
          >
            <!-- 展开列：渲染完整内容 -->
            <el-table-column type="expand">
              <template #default="{ row }">
                <pre class="chunk-full-content">{{ row.content }}</pre>
              </template>
            </el-table-column>
            <el-table-column prop="chunkIndex" label="#" width="72" align="right" header-align="right" class-name="chunk-num-col" />
            <el-table-column label="内容预览（点击行展开全文）" min-width="280">
              <template #default="{ row }">
                <div class="chunk-content">
                  <span class="content-preview">{{ row.preview }}</span>
                  <span class="expand-hint">{{ expandedChunk === row.chunkIndex ? '▲ 收起' : '▼ 展开' }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="章节路径" min-width="220">
              <template #default="{ row }">
                <span v-if="row.headingPath.length" class="path-chip">{{ row.headingPath.join(' / ') }}</span>
                <span v-else class="path-none">—</span>
              </template>
            </el-table-column>
            <el-table-column label="字数" width="80" align="right" header-align="right" class-name="chunk-num-col">
              <template #default="{ row }">{{ row.charCount.toLocaleString() }}</template>
            </el-table-column>
            <template #empty>
              <span>{{ chunks.length === 0 ? '暂无 chunk 数据' : '无匹配结果' }}</span>
            </template>
          </el-table>

          <!-- 章节树视图（每章一个节点行：标题 + 该章全部 chunk 为整体块） -->
          <el-tree
            v-else
            :data="chunkTreeData"
            node-key="id"
            class="chunk-tree"
            :props="{ children: 'none' }"
            empty-text=""
          >
            <template #default="{ data }">
              <div class="tree-block">
                <div class="tree-node h">
                  <span class="node-path">{{ data.label }}</span>
                  <span class="node-count">{{ data.count }} 块</span>
                </div>
                <div v-for="c in data.chunks" :key="c.id" class="tree-node leaf">
                  <span class="leaf-idx">#{{ c.chunkIndex }}</span>
                  <span class="leaf-meta">{{ c.charCount }} 字</span>
                  <span class="leaf-preview">{{ c.label }}</span>
                </div>
              </div>
            </template>
          </el-tree>
          <div v-if="chunkTree.length === 0" class="chunk-empty center">暂无 chunk 数据</div>
        </div>
      </el-tab-pane>

      <!-- 04 任务记录 -->
      <el-tab-pane label="04 任务记录" name="logs">
        <div class="tab-panel">
          <el-timeline v-if="taskLogs.length" class="task-timeline">
            <el-timeline-item
              v-for="log in taskLogs"
              :key="log.id"
              :type="timelineDotType(log.status)"
              :timestamp="formatTime(log.createdAt)"
              placement="top"
            >
              <div class="tl-head">
                <span class="tl-stage">{{ stageLabel(log.stage) }}</span>
                <span class="tl-dur">{{ formatDuration(log.durationMs) }}</span>
                <span :class="['tl-status', log.status.toLowerCase()]">{{ log.status }}</span>
              </div>
              <p v-if="log.message" :class="['tl-msg', { err: log.status === 'FAILED' }]">{{ log.message }}</p>
            </el-timeline-item>
          </el-timeline>
          <el-empty v-else description="暂无任务记录" />
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.doc-page {
  background: var(--sa-bg);
  min-height: calc(100vh - 52px);
}

/* ===== Header ===== */
.doc-header {
  display: flex;
  align-items: center;
  gap: var(--sa-gap);
  padding: 18px 24px;
  background: var(--sa-bg-card);
  border: 1px solid var(--sa-border-light);
  border-radius: var(--sa-radius-lg);
  margin-bottom: var(--sa-gap);
  box-shadow: var(--sa-shadow);
}
.back-link {
  font-size: 13px;
  color: var(--sa-text-secondary);
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.15s ease;
}
.back-link:hover { color: var(--sa-primary); }
.doc-id {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}
.doc-id-text { min-width: 0; }
.doc-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--sa-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.doc-file {
  font-size: 12px;
  color: var(--sa-text-placeholder);
  margin-top: 2px;
}
.header-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

/* ===== 按钮 ===== */
.btn {
  padding: 7px 14px;
  border: 1px solid var(--sa-border-input);
  border-radius: var(--sa-radius-sm);
  background: var(--sa-bg-card);
  color: var(--sa-text-regular);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn:hover { border-color: var(--sa-primary); color: var(--sa-primary); }
.btn[disabled] { opacity: 0.5; cursor: not-allowed; }
.btn-primary {
  background: var(--sa-primary);
  border-color: var(--sa-primary);
  color: #fff;
}
.btn-primary:hover { background: var(--sa-primary-hover); border-color: var(--sa-primary-hover); color: #fff; }
.btn-danger {
  background: transparent;
  border-color: var(--sa-border-input);
  color: #a8503a;
}
.btn-danger:hover { background: #f7e6e0; border-color: #a8503a; }

/* ===== Tab 区 ===== */
.doc-tabs {
  background: var(--sa-bg-card);
  border: 1px solid var(--sa-border-light);
  border-radius: var(--sa-radius-lg);
  padding: 0 24px 24px;
  box-shadow: var(--sa-shadow);
}
.doc-tabs :deep(.el-tabs__header) { margin-bottom: 20px; }
.doc-tabs :deep(.el-tabs__item) {
  font-size: 14px;
  font-weight: 500;
  color: var(--sa-text-secondary);
}
.doc-tabs :deep(.el-tabs__item.is-active) { color: var(--sa-primary); font-weight: 600; }
.doc-tabs :deep(.el-tabs__active-bar) { background-color: var(--sa-primary); }
.tab-panel { padding-top: 8px; }

/* ===== 00 KPI 卡 ===== */
.kpi-row {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}
.kpi-card {
  padding: 14px;
  background: var(--sa-bg-card);
  border: 1px solid var(--sa-border-light);
  border-radius: var(--sa-radius-md);
  box-shadow: var(--sa-shadow);
}
.kpi-name {
  font-size: 12px;
  color: var(--sa-text-secondary);
  margin-bottom: 6px;
}
.kpi-val {
  font-size: 22px;
  font-weight: 700;
  color: var(--sa-text-primary);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
.kpi-unit { font-size: 13px; font-weight: 500; color: var(--sa-text-secondary); }
.kpi-ctx {
  font-size: 11px;
  color: var(--sa-text-placeholder);
  margin-top: 4px;
}
.meta-grid { margin-top: 8px; }
.meta-grid code {
  font-family: var(--sa-font-mono);
  font-size: 12px;
  color: var(--sa-text-regular);
}

/* ===== 02 构建 ===== */
.build-area {
  padding: 24px;
  border: 1px solid var(--sa-border-light);
  border-radius: var(--sa-radius-md);
  background: var(--sa-bg-card);
}
.build-idle { border-style: dashed; background: transparent; }
.build-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.build-status-text {
  font-size: 14px;
  color: var(--sa-text-primary);
  font-weight: 500;
}
.progress-track {
  height: 8px;
  background: var(--sa-bg-sidebar);
  border-radius: var(--sa-radius-full);
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--sa-primary), var(--sa-primary-hover));
  border-radius: var(--sa-radius-full);
  transition: width 0.4s ease;
}
.progress-meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--sa-text-secondary);
  margin-top: 8px;
  font-variant-numeric: tabular-nums;
}
.stage-steps {
  display: flex;
  margin-top: 24px;
  gap: 0;
}
.stage-step {
  flex: 1;
  text-align: center;
  position: relative;
}
.stage-step:not(:last-child)::after {
  content: '';
  position: absolute;
  top: 9px;
  left: 50%;
  right: -50%;
  height: 3px;
  background: var(--sa-border);
}
.stage-step.done:not(:last-child)::after { background: var(--sa-primary-light); }
.stage-dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  margin: 0 auto 6px;
  background: var(--sa-border);
  border: 3px solid var(--sa-bg-card);
  position: relative;
  z-index: 1;
}
.stage-step.done .stage-dot { background: #5a9a5a; }
.stage-step.active .stage-dot {
  background: var(--sa-primary);
  box-shadow: 0 0 0 4px var(--sa-primary-light);
}
.stage-label {
  font-size: 12px;
  color: var(--sa-text-secondary);
}
.stage-step.done .stage-label { color: var(--sa-text-regular); }
.stage-step.active .stage-label { color: var(--sa-primary); font-weight: 600; }

/* 空闲态 */
.build-empty {
  text-align: center;
  padding: 32px 16px;
}
.build-icon {
  font-size: 36px;
  color: var(--sa-primary);
  margin-bottom: 12px;
}
.build-empty-text {
  font-size: 14px;
  color: var(--sa-text-secondary);
  margin-bottom: 16px;
}
.build-hint {
  font-size: 12px;
  color: var(--sa-text-placeholder);
  margin-top: 12px;
}

/* ===== 04 任务记录时间线 ===== */
.task-timeline { padding: 8px 0; }
.tl-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}
.tl-stage {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--sa-text-primary);
}
.tl-dur {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--sa-radius-full);
  background: var(--sa-bg-active);
  color: var(--sa-text-secondary);
  font-family: var(--sa-font-mono);
}
.tl-status {
  font-size: 11px;
  font-weight: 500;
}
.tl-status.success { color: #4a7a4a; }
.tl-status.running { color: var(--sa-primary); }
.tl-status.failed { color: #a8503a; }
.tl-msg {
  font-size: 12px;
  color: var(--sa-text-secondary);
  background: var(--sa-bg-sidebar);
  padding: 6px 10px;
  border-radius: var(--sa-radius-sm);
  font-family: var(--sa-font-mono);
}
.tl-msg.err {
  background: #f7e6e0;
  color: #a8503a;
}

/* ===== 01 配置策略 ===== */
.diff-banner {
  background: #fdf3e0;
  color: #a87515;
  padding: 8px 14px;
  border-radius: var(--sa-radius-sm);
  font-size: 12.5px;
  margin-bottom: 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
.diff-title { font-weight: 600; }
.diff-item del { text-decoration: line-through; opacity: 0.7; }
.diff-item ins { text-decoration: none; font-weight: 700; }

/* 推荐提示条（顶部轻量，不再占整列） */
.rec-hint-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  margin-bottom: 16px;
  background: linear-gradient(180deg, #fbf6f1 0%, var(--sa-bg-card) 80%);
  border: 1px solid var(--sa-primary-light);
  border-radius: var(--sa-radius-sm);
  font-size: 12.5px;
  flex-wrap: wrap;
}
.rec-hint-label { font-weight: 600; color: var(--sa-text-primary); }
.rec-hint-pipeline { color: var(--sa-primary-pressed); font-weight: 500; }
.rec-hint-reason { color: var(--sa-text-secondary); flex: 1; min-width: 200px; }
.btn-sm { padding: 4px 10px; font-size: 12px; flex-shrink: 0; }

/* 流水线组装卡片（单列） */
.config-col {
  border: 1px solid var(--sa-border-light);
  border-radius: var(--sa-radius-md);
  overflow: hidden;
}
.config-col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--sa-border-light);
}
.config-col-title { font-size: 13.5px; font-weight: 600; color: var(--sa-text-primary); }
.config-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--sa-radius-full);
  background: var(--sa-bg-active);
  color: var(--sa-text-secondary);
}
.config-body { padding: 16px; }
.form-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.form-row.half { flex: 1; margin-bottom: 12px; }
.form-row-pair { display: flex; gap: 12px; }
.form-label {
  width: 72px;
  flex-shrink: 0;
  font-size: 13px;
  color: var(--sa-text-secondary);
}
.form-input {
  flex: 1;
  padding: 7px 10px;
  border: 1px solid var(--sa-border-input);
  border-radius: var(--sa-radius-sm);
  font-size: 13px;
  color: var(--sa-text-primary);
  background: var(--sa-bg-card);
}
.form-input:disabled { cursor: not-allowed; }
.config-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--sa-border-light);
}
.config-tag.manual { background: var(--sa-primary-light); color: var(--sa-primary-pressed); }

/* 策略选择器 */
.strategy-picker { margin-bottom: 16px; }
.strategy-buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
.strategy-btn {
  padding: 6px 12px;
  border: 1px solid var(--sa-border-input);
  border-radius: var(--sa-radius-sm);
  background: var(--sa-bg-card);
  font-size: 12.5px;
  color: var(--sa-text-regular);
  cursor: pointer;
  transition: all 0.15s ease;
}
.strategy-btn:hover { border-color: var(--sa-primary); color: var(--sa-primary); background: var(--sa-primary-light); }
.strategy-hint { font-size: 11px; color: var(--sa-text-placeholder); margin-top: 6px; }

/* 流水线编辑器 */
.pipeline-editor { margin-bottom: 16px; }
.pipeline-list { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.pipeline-step-edit {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--sa-bg-card);
  border: 1px solid var(--sa-border-light);
  border-radius: var(--sa-radius-sm);
}
.step-num {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--sa-primary);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.step-label { font-size: 13px; font-weight: 500; color: var(--sa-text-primary); flex: 1; }
.step-role {
  font-size: 10.5px;
  padding: 2px 6px;
  border-radius: var(--sa-radius-sm);
  background: var(--sa-bg-active);
  color: var(--sa-text-secondary);
}
.step-remove {
  border: none;
  background: transparent;
  color: var(--sa-text-placeholder);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 4px;
}
.step-remove:hover { color: #a8503a; }
.pipeline-empty {
  padding: 16px;
  text-align: center;
  font-size: 12.5px;
  color: var(--sa-text-placeholder);
  border: 1px dashed var(--sa-border-input);
  border-radius: var(--sa-radius-sm);
}
.pipeline-warn {
  font-size: 11.5px;
  color: #a87515;
  margin-top: 6px;
}

/* ===== 03 chunk 预览 ===== */
/* 块大小统计卡 */
.chunk-stats {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}
.stat-card {
  padding: 12px;
  text-align: center;
  background: var(--sa-bg-card);
  border: 1px solid var(--sa-border-light);
  border-radius: var(--sa-radius-md);
}
.stat-num {
  font-size: 20px;
  font-weight: 700;
  color: var(--sa-primary);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
.stat-label {
  font-size: 11px;
  color: var(--sa-text-secondary);
  margin-top: 4px;
}

.chunk-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}
.view-toggle {
  display: flex;
  border: 1px solid var(--sa-border-input);
  border-radius: var(--sa-radius-sm);
  overflow: hidden;
}
.view-toggle button {
  padding: 6px 12px;
  border: none;
  background: var(--sa-bg-card);
  font-size: 12.5px;
  color: var(--sa-text-secondary);
  cursor: pointer;
}
.view-toggle button.active { background: var(--sa-primary-light); color: var(--sa-primary-pressed); font-weight: 600; }
.chunk-search {
  width: 200px;
  padding: 6px 10px;
  border: 1px solid var(--sa-border-input);
  border-radius: var(--sa-radius-sm);
  font-size: 13px;
}
.chunk-spacer { flex: 1; }

/* ===== 03 chunk 表格（el-table，暖色主题对齐 doc-table） ===== */
.chunk-el-table {
  border-radius: var(--sa-radius-lg);
  overflow: hidden;
}
.chunk-el-table :deep(.el-table__inner-wrapper) {
  border: 1px solid var(--sa-border);
  border-radius: var(--sa-radius-lg);
  overflow: hidden;
}
.chunk-el-table :deep(th.el-table__cell) {
  background: var(--sa-bg-card);
  color: var(--sa-text-secondary);
  font-weight: 600;
  font-size: 13px;
  border-bottom: 2px solid var(--sa-primary);
  padding: 13px 14px;
}
.chunk-el-table :deep(td.el-table__cell) {
  border-bottom: 1px solid var(--sa-border-light);
  font-size: 13px;
  padding: 12px 14px;
  vertical-align: middle;
}
/* hover 高亮：用 el-table 的 CSS 变量覆盖（避免 !important 与展开高亮互踩） */
.chunk-el-table :deep(.el-table) {
  --el-table-row-hover-bg-color: var(--sa-bg-hover);
}
/* 展开中的行：浅色底，与 hover 高亮自然叠加 */
.chunk-el-table :deep(.chunk-row-expanded > td) {
  background: var(--sa-primary-light);
}
/* 隐藏展开列：行点击 + ▲/▼ 已承担展开/收起，箭头入口冗余。
   EP 用 <colgroup><col width> 驱动列宽（layout-observer），必须压掉 col 宽度列才会塌缩；
   expand 列恒为第一列，故用 :first-child（若调整列顺序需同步） */
.chunk-el-table :deep(colgroup col:first-child) {
  width: 0 !important;
}
.chunk-el-table :deep(.el-table__expand-column) {
  padding: 0 !important;
}
.chunk-el-table :deep(.el-table__expand-column .el-table__expand-icon) {
  visibility: hidden;
}
/* 数字列（# / 字数）：等宽数字，多位数不抖动 */
.chunk-el-table :deep(td.chunk-num-col) {
  font-variant-numeric: tabular-nums;
}
/* 展开区背景：与详情行视觉连贯 */
.chunk-el-table :deep(.el-table__expanded-cell) {
  padding: 0 !important;
  background: var(--sa-bg-sidebar);
}

/* 内容预览单元格：预览文本省略 + 展开提示 */
.chunk-content {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.content-preview { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.expand-hint {
  font-size: 11px;
  color: var(--sa-primary);
  flex-shrink: 0;
  white-space: nowrap;
}

/* 展开区完整内容 */
.chunk-full-content {
  margin: 0;
  padding: 14px 16px;
  font-family: var(--sa-font-mono);
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--sa-text-regular);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 400px;
  overflow-y: auto;
}

/* 章节路径 chip */
.path-chip {
  display: inline-block;
  max-width: 100%;
  padding: 2px 8px;
  border-radius: var(--sa-radius-sm);
  background: #e8eef5;
  color: #4a6a8a;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}
.path-none { color: var(--sa-text-placeholder); }
.chunk-empty { text-align: center; padding: 24px; color: var(--sa-text-placeholder); }
.chunk-empty.center { padding: 40px; }

/* 章节树（el-tree 单层节点，标题 + 内容整体块，暖色主题适配） */
.chunk-tree { padding: 8px 0; background: transparent; --el-tree-node-hover-bg-color: var(--sa-bg-hover); }
/* 章节整体块：块内标题与内容、块与块之间的间距 */
.tree-block {
  padding: 6px 10px 10px;
  border-radius: var(--sa-radius-sm);
}
.tree-node.h { margin-bottom: 4px; }
.tree-node.leaf {
  padding: 4px 0;
  font-size: 12px;
  color: var(--sa-text-secondary);
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--sa-border-light);
  min-width: 0;
}
/* 节点行：取消 el-tree 默认行高限制（hover 背景作用于整个章节块） */
.chunk-tree :deep(.el-tree-node__content) {
  height: auto;
  padding: 2px 0;
  border-radius: var(--sa-radius-sm);
}
.node-path { font-size: 14px; font-weight: 600; color: var(--sa-primary); }
.node-count { font-size: 11px; color: var(--sa-text-placeholder); margin-left: 6px; }
.leaf-idx { font-variant-numeric: tabular-nums; color: var(--sa-text-placeholder); flex-shrink: 0; }
.leaf-meta { font-variant-numeric: tabular-nums; flex-shrink: 0; width: 60px; }
.leaf-preview {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--sa-text-regular);
}

/* ===== 响应式 ===== */
@media (max-width: 768px) {
  .kpi-row { grid-template-columns: repeat(2, 1fr); }
  .chunk-stats { grid-template-columns: repeat(2, 1fr); }
  .doc-header { flex-wrap: wrap; }
  .header-actions { width: 100%; }
}
</style>
