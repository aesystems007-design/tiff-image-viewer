<script setup lang="ts">
import { computed } from 'vue'
import { sanitizeAnnotationHtml } from '../annotations/htmlContent'
import type { ImageRun } from '../annotations/richText'
import { uneditableAnnotationStyle, uneditableAnnotationText, type UneditableAnnotation } from '../host/uneditableAnnotation'
import AnnotationHtml from './AnnotationHtml.vue'

const props = defineProps<{
  /** Position on screen, in viewer pixels. */
  left: number
  top: number
  width: number
  height: number
  /** Page-pixel size of the box, so HTML pixel sizes match the page. */
  contentWidth: number
  contentHeight: number
  annotation: UneditableAnnotation
  /** Picture inline with the label, sized in points. */
  imageRun?: ImageRun | null
  /** Screen pixels per point, so the picture scales with the page. */
  pxPerPt?: number
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
const html = computed(() => sanitizeAnnotationHtml(props.annotation.html))
const inlineImage = computed(() => (html.value ? null : (props.imageRun ?? null)))
</script>

<template>
  <div
    class="uneditable-annotation"
    :class="{ applied }"
    :style="style"
    :title="applied ? undefined : 'Annotation: drag to move it'"
    @pointerdown.stop="emit('press-move', $event)"
  >
    <AnnotationHtml
      v-if="html"
      :html="html"
      :content-width="contentWidth"
      :content-height="contentHeight"
      :scale="contentWidth > 0 ? width / contentWidth : 1"
    />
    <span v-else-if="text || inlineImage" class="label">
      {{ text }}<img
        v-if="inlineImage"
        class="inline-image"
        :src="inlineImage.image"
        alt=""
        draggable="false"
        :style="{ width: `${inlineImage.width * (pxPerPt || 1)}px`, height: `${inlineImage.height * (pxPerPt || 1)}px` }"
      />
    </span>
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

.inline-image {
  vertical-align: middle;
}

.uneditable-annotation.applied {
  outline: none;
  cursor: default;
  pointer-events: none;
}
</style>
