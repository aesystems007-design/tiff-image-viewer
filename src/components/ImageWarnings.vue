<script setup lang="ts">
import { ref, watch } from 'vue'
import { warningMessage, type ImageWarning } from '../warnings/imageWarning'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  warnings: readonly ImageWarning[]
}>()

const emit = defineEmits<{
  (e: 'select', page: number): void
}>()

const open = ref(false)

watch(
  () => props.warnings.length,
  (count) => {
    if (count === 0) open.value = false
  },
)
</script>

<template>
  <div v-if="warnings.length" class="warnings" :class="{ open }">
    <button type="button" class="summary" :aria-expanded="open" @click="open = !open">
      <AppIcon name="warning" class="warning" />
      <span class="label">
        {{ warnings.length === 1 ? '1 image warning' : `${warnings.length} image warnings` }}
      </span>
      <span v-if="!open" class="preview">{{ warningMessage(warnings[0]) }}</span>
      <AppIcon name="chevron-down" class="chevron" />
    </button>
    <ul v-if="open" class="list" role="list">
      <li v-for="warning in warnings" :key="warning.id">
        <button type="button" class="item" @click="emit('select', warning.page)">
          {{ warningMessage(warning) }}
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.warnings {
  flex-shrink: 0;
  border-bottom: 1px solid #e8d9a8;
  background: #fffbeb;
  color: #7a5b14;
}

.summary {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
  padding: 0.4rem 0.85rem;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 0.875rem;
  text-align: left;
  cursor: pointer;
}

.summary:hover {
  background: #fef3c7;
}

.summary .warning {
  color: #c58a0a;
  font-size: 0.95rem;
}

.label {
  font-weight: 600;
  white-space: nowrap;
}

.preview {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.85;
}

.preview::before {
  content: '— ';
  opacity: 0.6;
}

.chevron {
  margin-left: auto;
  font-size: 0.7rem;
  opacity: 0.7;
  transition: transform 0.15s ease;
}

.open .chevron {
  transform: rotate(-180deg);
}

.list {
  max-height: 9.5rem;
  margin: 0;
  padding: 0 0.35rem 0.4rem;
  overflow-y: auto;
  list-style: none;
  border-top: 1px solid #f0e2b0;
}

.item {
  display: block;
  width: 100%;
  padding: 0.35rem 0.5rem;
  border: none;
  border-radius: 4px;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 0.85rem;
  text-align: left;
  cursor: pointer;
}

.item:hover {
  background: #fef3c7;
  color: #1f3a68;
}
</style>
