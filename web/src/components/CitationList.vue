<script setup lang="ts">
/**
 * CitationList —— 引用来源列表
 * 从 useChat data parts 提取 citations，并按正文角标过滤：
 * 正文角标是模型自行标注的（可能只标了其中几条），只显示正文实际引用到的条目（角标数字 = citations 数组序号 + 1）；
 * 正文无角标或角标全部越界时回退显示全部（保守兜底，避免列表为空）
 */
import { computed, watch, ref } from 'vue'

const props = defineProps<{ data: unknown; content?: string }>()

interface Citation {
  chunkId: string
  documentId: string
  content: string
  score: number
  rank: number
}

/** 解析正文引用角标：[1] / [引用1] → 数字集合；无角标返回 null（不过滤） */
function parseCitationRefs(text: string): Set<number> | null {
  const refs = new Set<number>()
  const re = /\[(?:引用)?(\d+)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    // noUncheckedIndexedAccess：捕获组按索引访问是 string | undefined，正则已保证 \d+ 必命中
    if (m[1]) refs.add(parseInt(m[1], 10))
  }
  return refs.size > 0 ? refs : null
}

const citations = ref<Citation[]>([])

// 同时监听 data（引用帧到达）与 content（流式输出中角标逐步出现）
watch(
  [() => props.data, () => props.content],
  ([val]) => {
    if (!val) return
    // data 可能是数组或对象，遍历找 type=citations 的 part
    const parts = Array.isArray(val) ? val : [val]
    for (const p of parts) {
      if (p && typeof p === 'object' && (p as { type?: string }).type === 'citations') {
        const all = (p as { value: Citation[] }).value ?? []
        const refs = props.content ? parseCitationRefs(props.content) : null
        const filtered = refs ? all.filter((_, i) => refs.has(i + 1)) : all
        citations.value = filtered.length > 0 || !refs ? filtered : all
      }
    }
  },
  { deep: true, immediate: true },
)

const hasCitations = computed(() => citations.value.length > 0)
</script>

<template>
  <div v-if="hasCitations" class="citations">
    <div class="title">📎 引用来源</div>
    <div v-for="(c, i) in citations" :key="c.chunkId" class="citation-item">
      <span class="badge">{{ i + 1 }}</span>
      <span class="content">{{ c.content.slice(0, 120) }}{{ c.content.length > 120 ? '...' : '' }}</span>
    </div>
  </div>
</template>

<style scoped>
.citations {
  margin-top: 16px;
  padding: 12px 14px;
  background: var(--sa-bg-sidebar);
  border: 1px solid var(--sa-border);
  border-radius: var(--sa-radius-sm);
}
.title {
  font-size: 12px;
  color: var(--sa-text-secondary);
  margin-bottom: 8px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.citation-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  color: var(--sa-text-regular);
  margin: 6px 0;
  line-height: 1.6;
}
.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px; height: 20px;
  background: var(--sa-primary);
  color: white;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
  margin-top: 1px;
}
.content { color: var(--sa-text-secondary); }
</style>
