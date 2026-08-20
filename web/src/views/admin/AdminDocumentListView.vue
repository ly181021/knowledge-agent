<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { documentApi, type DocItem } from '@/api/document'
import type { DocumentStatus } from '@/types'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge.vue'
import FileTypeIcon from '@/components/admin/FileTypeIcon.vue'

const router = useRouter()
const list = ref<DocItem[]>([])
const total = ref(0)
const loading = ref(false)

const query = reactive({
  page: 1,
  size: 20,
  keyword: '',
  status: '' as DocumentStatus | '',
})

async function fetchList(silent = false) {
  if (!silent) loading.value = true
  try {
    const res = (await documentApi.list({
      page: query.page,
      size: query.size,
      keyword: query.keyword || undefined,
      status: query.status || undefined,
    })) as unknown as { page: number; size: number; total: number; items: DocItem[] }
    list.value = res.items
    total.value = res.total
  } catch {
    /* 拦截器已提示 */
  } finally {
    if (!silent) loading.value = false
  }
}

function onSearch() {
  query.page = 1
  fetchList()
}

async function onUpload(file: File) {
  try {
    // 拦截器已解包 {code,message,data}，运行时返回 DocItem（类型标注为 AxiosResponse，与 fetchList 同样强转）
    const doc = (await documentApi.upload(file)) as unknown as DocItem
    ElMessage.success('上传成功，文档进入解析队列')
    fetchList()
    // 轮询：每次先静默刷新列表再判断该文档是否到达终态（INDEXED/FAILED），超时 90s 兜底停止
    const docId = doc.id
    const startedAt = Date.now()
    const timer = setInterval(async () => {
      await fetchList(true)
      const cur = list.value.find((d) => d.id === docId)
      if ((cur && (cur.status === 'INDEXED' || cur.status === 'FAILED')) || Date.now() - startedAt > 90_000) {
        clearInterval(timer)
      }
    }, 2000)
  } catch {
    /* 拦截器已提示 */
  }
  return false // 阻止 el-upload 默认上传
}

async function onRemove(row: DocItem) {
  await ElMessageBox.confirm(`确定删除《${row.title}》？`, '软删确认', { type: 'warning' })
  await documentApi.remove(row.id)
  ElMessage.success('已删除')
  fetchList()
}

function openDetail(row: DocItem) {
  router.push(`/admin/documents/${row.id}`)
}

onMounted(fetchList)
</script>

<template>
  <div class="doc-list">
    <h3>文档管理</h3>
    <div class="toolbar">
      <el-input v-model="query.keyword" placeholder="搜索标题 / 文件名" clearable style="width: 240px" @keyup.enter="onSearch">
        <template #prefix><span style="color: var(--sa-text-placeholder)">🔍</span></template>
      </el-input>
      <el-select v-model="query.status" placeholder="全部状态" clearable style="width: 140px" @change="onSearch">
        <el-option label="解析中" value="PARSING" />
        <el-option label="重建中" value="INDEXING" />
        <el-option label="已索引" value="INDEXED" />
        <el-option label="失败" value="FAILED" />
        <el-option label="已删除" value="SOFT_DELETED" />
      </el-select>
      <el-button type="primary" @click="onSearch">搜索</el-button>
      <div class="spacer" />
      <el-upload :http-request="(opt: any) => onUpload(opt.file as File)" :show-file-list="false" accept=".pdf,.docx,.txt,.md">
        <el-button type="primary" class="upload-btn">↑ 上传文档</el-button>
      </el-upload>
    </div>

    <el-table v-loading="loading" :data="list" class="doc-table" @row-click="openDetail">
      <el-table-column label="文档" min-width="180">
        <template #default="{ row }">
          <div class="doc-name">
            <FileTypeIcon :file-type="row.fileType" />
            <div class="doc-name-text">
              <div class="dn-title">{{ row.title }}</div>
              <div class="dn-meta">{{ row.fileName }}</div>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="fileType" label="类型" min-width="80" align="center" header-align="center" />
      <el-table-column label="大小" min-width="100" align="center" header-align="center">
        <template #default="{ row }">{{ (row.fileSize / 1024).toFixed(1) }} KB</template>
      </el-table-column>
      <el-table-column label="更新时间" min-width="160" align="center" header-align="center">
        <template #default="{ row }">{{ new Date(row.updatedAt).toLocaleString() }}</template>
      </el-table-column>
      <el-table-column label="解析" min-width="100" align="center" header-align="center">
        <template #default="{ row }"><AdminStatusBadge :status="row.status" :parse-stage="row.parseStage" :error-msg="row.errorMsg" /></template>
      </el-table-column>
      <el-table-column label="策略" min-width="80" align="center" header-align="center">
        <template #default="{ row }">
          <span class="strategy-cell">{{ row.headingStrategy || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="索引" min-width="90" align="center" header-align="center">
        <template #default="{ row }">
          <span class="index-cell">{{ row.chunkCount != null ? row.chunkCount : '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" min-width="160" fixed="right" align="center" header-align="center">
        <template #default="{ row }">
          <div class="row-actions">
            <el-button text type="primary" size="small" @click.stop="openDetail(row as unknown as DocItem)">查看详情</el-button>
            <!-- 已删除留痕记录：删除无意义，隐藏（后端 list 默认不返回，仅审计筛选可见） -->
            <el-button v-if="row.status !== 'SOFT_DELETED'" text type="danger" size="small" @click.stop="onRemove(row as unknown as DocItem)">删除</el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      v-model:current-page="query.page"
      v-model:page-size="query.size"
      :total="total"
      layout="total, prev, pager, next"
      class="pagination"
      @current-change="() => fetchList()"
    />
  </div>
</template>

<style scoped>
.doc-list { padding: 0; }
.doc-list h3 { color: var(--sa-text-primary); margin: 0 0 16px; font-size: 20px; font-weight: 600; }

.toolbar { display: flex; gap: 10px; margin-bottom: 16px; align-items: center; flex-wrap: wrap; }
.spacer { flex: 1; }

/* 文档名单元格：图标 + 标题/文件名（溢出省略，控制列宽） */
.doc-name { display: flex; align-items: center; gap: 10px; }
.doc-name-text { min-width: 0; flex: 1; }
.dn-title {
  font-weight: 500;
  color: var(--sa-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dn-meta {
  font-size: 11px;
  color: var(--sa-text-placeholder);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* kebab 已移除，操作改为显式文字按钮 */
.row-actions { display: flex; gap: 4px; align-items: center; }

/* 策略/索引单元格：次要信息，暖灰，强制单行不换行 */
.strategy-cell, .index-cell {
  font-size: 13px;
  color: var(--sa-text-secondary);
  white-space: nowrap;
}

/* 表格：圆角加大 + 白表头陶土下划线 + 字体稍大 */
.doc-table {
  border-radius: var(--sa-radius-lg);
  overflow: hidden;
}
.doc-table :deep(.el-table__inner-wrapper) {
  border: 1px solid var(--sa-border);
  border-radius: var(--sa-radius-lg);
  overflow: hidden;
}
.doc-table :deep(th.el-table__cell) {
  background: var(--sa-bg-card);
  color: var(--sa-text-secondary);
  font-weight: 600;
  font-size: 13px;
  border-bottom: 2px solid var(--sa-primary);
  padding: 13px 14px;
}
.doc-table :deep(td.el-table__cell) {
  border-bottom: 1px solid var(--sa-border-light);
  font-size: 14px;
  padding: 13px 14px;
}
.doc-table :deep(.el-table__row:hover > td) {
  background: var(--sa-bg-hover) !important;
}
.pagination { margin-top: 16px; justify-content: flex-end; }

/* 窄屏 */
@media (max-width: 768px) {
  .toolbar { flex-direction: column; align-items: stretch; gap: 8px; }
  .spacer { display: none; }
  .doc-list h3 { font-size: 18px; }
}
</style>
