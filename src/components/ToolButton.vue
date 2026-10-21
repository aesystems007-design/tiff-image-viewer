<script setup lang="ts">
import type { IconName } from '../icons/icons'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  icon: IconName
  title: string
  disabled?: boolean
  active?: boolean
  /** Bigger icon; used for the "all pages" variants. */
  large?: boolean
  /** Draw the icon slightly tilted (deskew). */
  tilt?: boolean
  /** Shown but not functional yet. */
  placeholder?: boolean
}>()

const emit = defineEmits<{
  (e: 'click'): void
}>()
</script>

<template>
  <!-- Tooltip lives on the wrapper because disabled buttons don't show one in every browser. -->
  <span class="tool-wrap" :title="props.placeholder ? `${props.title} (not available yet)` : props.title">
    <button
      type="button"
      class="tool"
      :class="{ active: props.active, large: props.large }"
      :aria-label="props.title"
      :aria-pressed="props.active ? 'true' : undefined"
      :disabled="props.disabled || props.placeholder"
      @click="emit('click')"
    >
      <AppIcon :name="props.icon" :class="{ skewed: props.tilt }" />
    </button>
  </span>
</template>

<style scoped>
.tool-wrap {
  display: inline-flex;
}

.tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  color: var(--toolbar-icon);
  font-size: 1.05rem;
  cursor: pointer;
}

.tool.large {
  font-size: 1.5rem;
  color: var(--toolbar-icon-strong);
}

.tool:hover:not(:disabled) {
  background: var(--toolbar-hover);
}

.tool.active {
  border-color: var(--toolbar-icon);
  background: var(--toolbar-hover);
}

.tool:disabled {
  opacity: 0.35;
  cursor: default;
}
</style>
