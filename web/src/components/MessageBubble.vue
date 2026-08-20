<script setup lang="ts">
/**
 * MessageBubble —— 消息气泡
 * 用户消息：暖灰背景右对齐，胶囊圆角
 * 助手消息：无背景纯文字左对齐，编辑感排版
 */
import { computed, ref } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { ElMessage } from 'element-plus'
import CitationList from './CitationList.vue'
import RecommendationList from './RecommendationList.vue'

const props = defineProps<{
  role: 'user' | 'assistant' | 'system'
  content: string
  data?: unknown
}>()

const emit = defineEmits<{ select: [question: string] }>()
const html = computed(() => {
  if (props.role === 'user') return props.content
  // 引用角标格式统一：LLM 生成的 [引用1] → [1]（在纯文本阶段替换，避免误伤 markdown 链接 [text](url) 语法）
  const display = props.content.replace(/\[引用(\d+)\]/g, '[$1]')
  const raw = marked.parse(display, { async: false }) as string
  return DOMPurify.sanitize(raw)
})

const copied = ref(false)

async function copyContent() {
  try {
    await navigator.clipboard.writeText(props.content)
    copied.value = true
    ElMessage.success('已复制')
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    ElMessage.error('复制失败')
  }
}
</script>

<template>
  <div :class="['msg', role]">
    <!-- 用户消息：右对齐 + 暖灰背景 -->
    <div v-if="role === 'user'" class="msg-user">
      <button class="copy-btn" :title="copied ? '已复制' : '复制'" :aria-label="copied ? '已复制' : '复制'" @click="copyContent">
        {{ copied ? '✓' : '复制' }}
      </button>
      <div class="bubble-user">{{ content }}</div>
    </div>

    <!-- 助手消息：左对齐 + 无背景纯文字 -->
    <div v-else class="msg-assistant">
      <div class="bubble-assistant" v-html="html"></div>
      <div class="assistant-actions">
        <button class="copy-btn" :title="copied ? '已复制' : '复制'" :aria-label="copied ? '已复制' : '复制'" @click="copyContent">
          {{ copied ? '✓' : '复制' }}
        </button>
      </div>
      <CitationList v-if="data" :data="data" :content="content" />
      <RecommendationList v-if="data" :data="data" @select="(q: string) => emit('select', q)" />
    </div>
  </div>
</template>

<style scoped>
.msg { margin: 20px 0; }

/* ===== 用户消息 ===== */
.msg-user { display: flex; justify-content: flex-end; align-items: flex-start; gap: 8px; position: relative; }
.bubble-user {
  background: var(--sa-bg-user-msg);
  border-radius: var(--sa-radius-lg) var(--sa-radius-lg) var(--sa-radius-sm) var(--sa-radius-lg);
  padding: 10px 16px;
  max-width: 75%;
  font-size: 15px;
  line-height: 1.6;
  color: var(--sa-text-primary);
  word-break: break-word;
}

/* ===== 助手消息：纯文字，编辑感排版 ===== */
.msg-assistant { position: relative; }
.bubble-assistant {
  font-size: 15px;
  line-height: 1.75;
  color: var(--sa-text-primary);
  word-break: break-word;
}
.bubble-assistant :deep(p) { margin: 0.75em 0; }
.bubble-assistant :deep(p:first-child) { margin-top: 0; }
.bubble-assistant :deep(p:last-child) { margin-bottom: 0; }
.bubble-assistant :deep(h1),
.bubble-assistant :deep(h2),
.bubble-assistant :deep(h3),
.bubble-assistant :deep(h4) {
  color: var(--sa-text-primary);
  margin: 1.2em 0 0.6em;
  font-weight: 600;
  line-height: 1.3;
}
.bubble-assistant :deep(h1) { font-size: 1.5em; }
.bubble-assistant :deep(h2) { font-size: 1.3em; }
.bubble-assistant :deep(h3) { font-size: 1.15em; }
.bubble-assistant :deep(ul),
.bubble-assistant :deep(ol) { padding-left: 1.5em; margin: 0.75em 0; }
.bubble-assistant :deep(li) { margin: 0.35em 0; }
.bubble-assistant :deep(li > p) { margin: 0; }
.bubble-assistant :deep(strong) { color: var(--sa-text-primary); font-weight: 600; }
.bubble-assistant :deep(blockquote) {
  border-left: 3px solid var(--sa-primary);
  padding-left: 14px;
  margin: 1em 0;
  color: var(--sa-text-secondary);
  font-style: normal;
}

/* 代码块：暖深色背景 */
.bubble-assistant :deep(pre) {
  background: var(--sa-bg-code);
  padding: 14px 18px;
  border-radius: var(--sa-radius-sm);
  overflow-x: auto;
  margin: 1em 0;
  font-size: 13.5px;
}
.bubble-assistant :deep(pre code) {
  background: none;
  color: var(--sa-text-code);
  padding: 0;
  font-size: 13.5px;
  font-family: var(--sa-font-mono);
  line-height: 1.6;
}
.bubble-assistant :deep(code) {
  background: var(--sa-bg-hover);
  color: var(--sa-primary-pressed);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 0.9em;
  font-family: var(--sa-font-mono);
}
.bubble-assistant :deep(table) {
  border-collapse: collapse;
  margin: 1em 0;
  width: 100%;
  font-size: 14px;
}
.bubble-assistant :deep(th),
.bubble-assistant :deep(td) {
  border: 1px solid var(--sa-border);
  padding: 8px 12px;
  text-align: left;
}
.bubble-assistant :deep(th) { background: var(--sa-bg-sidebar); font-weight: 600; color: var(--sa-text-primary); }
.bubble-assistant :deep(a) { color: var(--sa-primary); text-decoration: underline; text-underline-offset: 2px; }

/* ===== 助手操作栏 ===== */
.assistant-actions {
  display: flex;
  gap: 4px;
  margin-top: 6px;
  opacity: 0;
  transition: var(--sa-transition);
}
.msg-assistant:hover .assistant-actions { opacity: 1; }

/* ===== 复制按钮 ===== */
.copy-btn {
  border: none;
  background: transparent;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--sa-text-secondary);
  cursor: pointer;
  opacity: 0;
  transition: var(--sa-transition);
  flex-shrink: 0;
}
.msg-user:hover .copy-btn { opacity: 1; }
.copy-btn:hover { color: var(--sa-primary); background: var(--sa-bg-hover); }
</style>
