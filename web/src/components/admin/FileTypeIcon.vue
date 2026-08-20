<script setup lang="ts">
/**
 * FileTypeIcon —— 文件类型彩色图标（方案 1 文档表格用）
 * 用后缀色块 + 文字增强识别（PDF红/DOCX蓝/MD绿/TXT灰），色盲不依赖颜色（配文字）
 */
import { computed } from 'vue'

const props = defineProps<{
  fileType: string
}>()

const meta = computed<{ label: string; cls: string }>(() => {
  const ext = props.fileType?.toLowerCase().replace(/^\./, '') ?? ''
  if (ext === 'pdf') return { label: 'PDF', cls: 'is-pdf' }
  if (ext === 'docx' || ext === 'doc') return { label: 'DOC', cls: 'is-docx' }
  if (ext === 'md' || ext === 'markdown') return { label: 'MD', cls: 'is-md' }
  if (ext === 'txt') return { label: 'TXT', cls: 'is-txt' }
  return { label: ext.slice(0, 4).toUpperCase() || 'FILE', cls: 'is-txt' }
})
</script>

<template>
  <span :class="['ftype', meta.cls]" aria-hidden="true">{{ meta.label }}</span>
</template>

<style scoped>
.ftype {
  display: inline-flex;
  align-items: flex-end;
  justify-content: center;
  width: 32px;
  height: 38px;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 700;
  color: #fff;
  padding-bottom: 4px;
  flex-shrink: 0;
  letter-spacing: 0.3px;
}
.is-pdf { background: #c4503a; }
.is-docx { background: #4a6a8a; }
.is-md { background: #6a8a6a; }
.is-txt { background: #6b6258; }
</style>
