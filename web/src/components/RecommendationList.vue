<script setup lang="ts">
/**
 * RecommendationList —— 推荐追问列表
 * 从 useChat data parts 提取 recommendations（帧 2，type='recommendations'）
 * 点击追问按钮 → emit('select', question) → 父组件回填输入框并发送
 */
import { computed, watch, ref } from 'vue'

const props = defineProps<{ data: unknown }>()
const emit = defineEmits<{ select: [question: string] }>()

const recommendations = ref<string[]>([])

watch(
  () => props.data,
  (val) => {
    if (!val) return
    // data 可能是数组或对象，遍历找 type=recommendations 的 part
    const parts = Array.isArray(val) ? val : [val]
    for (const p of parts) {
      if (p && typeof p === 'object' && (p as { type?: string }).type === 'recommendations') {
        const value = (p as { value: unknown }).value
        if (Array.isArray(value)) {
          recommendations.value = value.filter((q): q is string => typeof q === 'string')
        }
      }
    }
  },
  { deep: true, immediate: true },
)

const hasRecommendations = computed(() => recommendations.value.length > 0)

function onSelect(q: string) {
  emit('select', q)
}
</script>

<template>
  <div v-if="hasRecommendations" class="recommendations">
    <div class="title">💡 推荐追问</div>
    <div class="rec-list">
      <button
        v-for="(q, i) in recommendations"
        :key="i"
        type="button"
        class="rec-item"
        @click="onSelect(q)"
      >
        {{ q }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.recommendations {
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
.rec-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rec-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 12px;
  border: 1px solid var(--sa-border-input);
  border-radius: var(--sa-radius-sm);
  background: var(--sa-bg-card);
  color: var(--sa-text-regular);
  font-size: 13px;
  line-height: 1.5;
  cursor: pointer;
  transition: var(--sa-transition);
}
.rec-item:hover {
  border-color: var(--sa-primary);
  color: var(--sa-primary);
  background: var(--sa-bg-hover);
}
</style>
