<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'

type Adjustment = 'contrast' | 'brightness'

const emit = defineEmits<{
  /** `amount` on the CSS contrast() / brightness() scale: 1 = unchanged. */
  (e: 'adjust', kind: Adjustment, amount: number): void
  (e: 'despeckle'): void
  (e: 'erase'): void
  (e: 'clear'): void
  /** Live preview while a slider is open, as a CSS filter; null ends the preview. */
  (e: 'preview-filter', filter: string | null): void
}>()

const ADJUSTMENTS: Record<Adjustment, { label: string; min: number; max: number; initial: number }> = {
  brightness: { label: 'Brightness', min: 25, max: 200, initial: 120 },
  contrast: { label: 'Contrast', min: 25, max: 300, initial: 150 },
}

const open = ref<Adjustment | null>(null)
const percent = reactive<Record<Adjustment, number>>({
  brightness: ADJUSTMENTS.brightness.initial,
  contrast: ADJUSTMENTS.contrast.initial,
})
const current = computed(() => (open.value ? ADJUSTMENTS[open.value] : null))

watch([open, () => ({ ...percent })], ([kind]) =>
  emit('preview-filter', kind ? `${kind}(${percent[kind] / 100})` : null),
)

function toggle(kind: Adjustment) {
  open.value = open.value === kind ? null : kind
}

function apply() {
  if (!open.value) return
  emit('adjust', open.value, percent[open.value] / 100)
  open.value = null
}
</script>

<template>
  <div class="area-actions" role="toolbar" aria-label="Selected area actions">
    <div class="buttons">
      <button
        type="button"
        :class="{ active: open === 'brightness' }"
        title="Change brightness of the area"
        @click="toggle('brightness')"
      >
        <AppIcon name="brightness" /> Brightness
      </button>
      <button type="button" :class="{ active: open === 'contrast' }" title="Change contrast of the area" @click="toggle('contrast')">
        <AppIcon name="contrast" /> Contrast
      </button>
      <button type="button" title="Remove small specks in the area" @click="emit('despeckle')">
        <AppIcon name="despeckle" /> Despeckle
      </button>
      <button type="button" title="Erase the area to white (Delete)" @click="emit('erase')">
        <AppIcon name="eraser" /> Erase
      </button>
      <button type="button" class="icon-only" title="Clear selection (Esc)" aria-label="Clear selection" @click="emit('clear')">
        <AppIcon name="close" />
      </button>
    </div>
    <div v-if="open && current" class="slider">
      <input
        v-model.number="percent[open]"
        type="range"
        :min="current.min"
        :max="current.max"
        step="5"
        :aria-label="current.label"
      />
      <output>{{ percent[open] }}%</output>
      <button type="button" class="primary" @click="apply">Apply</button>
      <button type="button" @click="open = null">Cancel</button>
    </div>
  </div>
</template>

<style scoped>
.area-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px;
  border: 1px solid #c9d1dd;
  border-radius: 6px;
  background: #fff;
  color: #1d2635;
  box-shadow: 0 4px 14px rgb(0 0 0 / 30%);
  font-size: 13px;
  white-space: nowrap;
  user-select: none;
}

.buttons,
.slider {
  display: flex;
  align-items: center;
  gap: 4px;
}

button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  color: #1f3a68;
  font: inherit;
  cursor: pointer;
}

button:hover,
button.active {
  background: #e8eef8;
}

button.active {
  border-color: #1f3a68;
}

button.icon-only {
  width: 28px;
  justify-content: center;
  padding: 0;
}

button.primary {
  background: #3d64b5;
  color: #fff;
}

.slider {
  padding: 2px 4px 0;
  border-top: 1px solid #e3e8ef;
}

.slider input {
  width: 140px;
}

.slider output {
  width: 3rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
