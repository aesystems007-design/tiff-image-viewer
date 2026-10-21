<script setup lang="ts">
import AppIcon from './AppIcon.vue'

defineProps<{
  /** The move made on the shown page, e.g. `1.14" right, 0.50" down`. */
  move: string
  /** Pages the move would be copied to. */
  otherPages: number
}>()

const emit = defineEmits<{
  (e: 'all'): void
  (e: 'dismiss'): void
}>()
</script>

<template>
  <div class="move-prompt" role="group" aria-label="Move all pages">
    <AppIcon name="reposition" />
    <span class="question">
      Move all pages the same way?
      <span class="move">({{ move }})</span>
    </span>
    <button type="button" class="primary" :title="`Move the other ${otherPages} pages ${move}`" @click="emit('all')">
      All pages
    </button>
    <button type="button" title="Keep the move on this page only" @click="emit('dismiss')">Just this page</button>
  </div>
</template>

<style scoped>
.move-prompt {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 6px 6px 12px;
  border: 1px solid #c9d1dd;
  border-radius: 6px;
  background: #fff;
  color: #1d2635;
  box-shadow: 0 4px 14px rgb(0 0 0 / 30%);
  font-size: 13px;
  white-space: nowrap;
  user-select: none;
}

.move-prompt > i {
  color: #1f3a68;
}

.move {
  color: #4a5568;
}

button {
  height: 28px;
  padding: 0 10px;
  border: 1px solid #c9d1dd;
  border-radius: 4px;
  background: #fff;
  color: #1f3a68;
  font: inherit;
  cursor: pointer;
}

button:hover {
  background: #e8eef8;
}

button.primary {
  border-color: #3d64b5;
  background: #3d64b5;
  color: #fff;
}

button.primary:hover {
  background: #27498c;
}
</style>
