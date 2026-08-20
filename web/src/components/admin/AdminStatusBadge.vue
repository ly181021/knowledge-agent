<script setup lang="ts">
/**
 * AdminStatusBadge —— 文档状态徽章（色点 + 文字双冗余，色盲友好）
 * PARSING(琥珀)/INDEXED(绿)/FAILED(红)/SOFT_DELETED(灰)
 * 颜色不单独承载信息，配文字 + 色点
 * PARSING 态可选展示 parseStage 细化（解析中·切块）；FAILED 态可选 tooltip 显示 errorMsg
 */
import { computed } from 'vue'
import type { DocumentStatus, ParseStage } from '@/types'

const props = defineProps<{
  status: DocumentStatus
  /** 解析阶段（PARSING 期间细化展示，如"解析中·切块"） */
  parseStage?: ParseStage | null
  /** 失败详情（FAILED 时 tooltip 展示） */
  errorMsg?: string | null
}>()

const map: Record<DocumentStatus, { text: string; cls: string }> = {
  PARSING: { text: '解析中', cls: 'is-warn' },
  INDEXING: { text: '重建中', cls: 'is-build' },
  INDEXED: { text: '已索引', cls: 'is-ok' },
  FAILED: { text: '失败', cls: 'is-err' },
  SOFT_DELETED: { text: '已删除', cls: 'is-neutral' },
}

/** parseStage → 中文短词（拼在"解析中"后面） */
const parseStageLabel: Record<ParseStage, string> = {
  UPLOADED: '等待',
  PARSING: '文本',
  CHUNKING: '切块',
  VECTORIZING: '向量',
  INDEXED: '完成',
}

const cur = computed(() => map[props.status] ?? { text: props.status, cls: 'is-neutral' })

/** PARSING 态的细化文案（如"解析中·切块"），无 parseStage 则只显示"解析中" */
const displayText = computed(() => {
  if (props.status === 'PARSING' && props.parseStage) {
    const sub = parseStageLabel[props.parseStage]
    return sub ? `${cur.value.text}·${sub}` : cur.value.text
  }
  return cur.value.text
})
</script>

<template>
  <!-- FAILED 且有 errorMsg 时包 tooltip；否则纯徽章 -->
  <el-tooltip v-if="status === 'FAILED' && errorMsg" :content="errorMsg" placement="top" :show-after="300">
    <span :class="['status-badge', cur.cls]">
      <span class="dot" />
      {{ displayText }}
    </span>
  </el-tooltip>
  <span v-else :class="['status-badge', cur.cls]">
    <span class="dot" />
    {{ displayText }}
  </span>
</template>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: var(--sa-radius-full);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
  white-space: nowrap;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}
/* 语义色（与设计稿一致） */
.is-ok { background: #e8f3e8; color: #4a7a4a; }
.is-warn { background: #fdf3e0; color: #a87515; }
.is-err { background: #f7e6e0; color: #a8503a; }
.is-build { background: var(--sa-build-bg); color: var(--sa-build-fg); }
.is-neutral { background: var(--sa-bg-active); color: var(--sa-text-secondary); }
</style>
