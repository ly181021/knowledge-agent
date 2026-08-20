<script setup lang="ts">
/**
 * SessionList —— 会话列表，按时间分组渲染
 * 展开态显示分组标题；收起态平铺不分组
 */
import { computed } from 'vue'
import SessionItem from './SessionItem.vue'
import { groupSessionsByTime } from '@/utils/session-group'

interface SessionLike {
  id: string
  title?: string | null
  updatedAt: string
}

const props = defineProps<{
  sessions: SessionLike[]
  activeId: string
  collapsed: boolean
}>()

const emit = defineEmits<{ select: [id: string] }>()

const groups = computed(() =>
  props.collapsed ? null : groupSessionsByTime(props.sessions),
)

const GROUP_LABEL = {
  today: '今天',
  yesterday: '昨天',
  week: '7 天内',
  earlier: '更早',
} as const
</script>

<template>
  <div class="session-list" data-test="session-list">
    <!-- 收起态：平铺不分组 -->
    <template v-if="collapsed">
      <SessionItem
        v-for="s in sessions"
        :key="s.id"
        :title="s.title ?? ''"
        :updated-at="s.updatedAt"
        :active="s.id === activeId"
        :collapsed="true"
        @select="emit('select', s.id)"
      />
    </template>

    <!-- 展开态：分组 -->
    <template v-else>
      <template v-for="key in (['today','yesterday','week','earlier'] as const)" :key="key">
        <div v-if="groups && groups[key].length" class="group-label">{{ GROUP_LABEL[key] }}</div>
        <SessionItem
          v-for="s in (groups?.[key] ?? [])"
          :key="s.id"
          :title="s.title ?? ''"
          :updated-at="s.updatedAt"
          :active="s.id === activeId"
          :collapsed="false"
          @select="emit('select', s.id)"
        />
      </template>
    </template>
  </div>
</template>

<style scoped>
.session-list { flex: 1; overflow-y: auto; padding: 4px 8px; }

/* 收起态：去内边距 + 隐藏滚动条（Windows 滚动条占 17px 会压图标）*/
:global(.sidebar.collapsed) .session-list {
  padding: 0;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
:global(.sidebar.collapsed) .session-list::-webkit-scrollbar {
  display: none;
}

.group-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--sa-text-secondary);
  padding: 12px 10px 4px;
  letter-spacing: 0.8px;
  text-transform: uppercase;
}
</style>
