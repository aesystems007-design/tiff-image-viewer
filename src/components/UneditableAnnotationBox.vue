<script setup lang="ts">
import { computed } from 'vue'
import { uneditableAnnotationStyle, uneditableAnnotationText, type UneditableAnnotation } from '../host/uneditableAnnotation'

const props = defineProps<{
  /** Position on screen, in viewer pixels. */
  left: number
  top: number
  width: number
  height: number
  annotation: UneditableAnnotation
  /** Screen pixels per DPI-requirement pixel at the current zoom. */
  scale: number
  /** Its location was applied: shown where it is, can't be moved. */
  applied?: boolean
}>()

const emit = defineEmits<{
  (e: 'press-move', event: PointerEvent): void
}>()

const style = computed(() => ({
  ...uneditableAnnotationStyle(props.annotation, props.scale),
  left: `${props.left}px`,
  top: `${props.top}px`,
  width: `${props.width}px`,
  height: `${props.height}px`,
}))
const text = computed(() => uneditableAnnotationText(props.annotation))
</script>

<template>
  <div
    class="uneditable-annotation"
    :class="{ applied }"
    :style="style"
    :title="applied ? undefined : 'Annotation: drag to move it'"
    @pointerdown.stop="emit('press-move', $event)"
  >
    <span v-if="text">{{ text }}</span>
  </div>
</template>

<style scoped>
.uneditable-annotation {
  position: absolute;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  outline: 1px dashed rgb(31 58 104 / 70%);
  line-height: 1.2;
  white-space: pre-wrap;
  overflow: hidden;
  cursor: move;
  pointer-events: auto;
  touch-action: none;
  user-select: none;
}

.uneditable-annotation.applied {
  outline: none;
  cursor: default;
  pointer-events: none;
}
</style>
