<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import ToolButton from './ToolButton.vue'

defineProps<{
  disabled?: boolean
}>()

/** Percentages; 100 = unchanged. */
const brightness = defineModel<number>('brightness', { required: true })
const contrast = defineModel<number>('contrast', { required: true })

const open = ref(false)
const root = ref<HTMLElement>()

function onDocumentPointerDown(event: PointerEvent) {
  if (open.value && !root.value?.contains(event.target as Node)) open.value = false
}

function reset() {
  brightness.value = 100
  contrast.value = 100
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown))
</script>

<template>
  <div ref="root" class="adjustments">
    <ToolButton
      icon="brightness"
      title="Brightness / contrast"
      :active="open || brightness !== 100 || contrast !== 100"
      :disabled="disabled"
      @click="open = !open"
    />
    <div v-if="open" class="panel" role="dialog" aria-label="Brightness and contrast">
      <label>
        <span>Brightness</span>
        <input v-model.number="brightness" type="range" min="20" max="200" step="5" />
        <output>{{ brightness }}%</output>
      </label>
      <label>
        <span>Contrast</span>
        <input v-model.number="contrast" type="range" min="20" max="300" step="5" />
        <output>{{ contrast }}%</output>
      </label>
      <button type="button" class="reset" @click="reset">Reset</button>
    </div>
  </div>
</template>

<style scoped>
.adjustments {
  position: relative;
  display: inline-flex;
}

.panel {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  width: 300px;
  padding: 0.75rem;
  border: 1px solid var(--toolbar-border);
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 6px 18px rgb(0 0 0 / 25%);
}

label {
  display: grid;
  grid-template-columns: 5rem minmax(0, 1fr) 3rem;
  align-items: center;
  gap: 0.5rem;
}

input[type='range'] {
  width: 100%;
  min-width: 0;
  margin: 0;
}

output {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.reset {
  align-self: flex-end;
  padding: 0.25rem 0.75rem;
  border: 1px solid var(--toolbar-border);
  border-radius: 4px;
  background: #f4f6f9;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
</style>
