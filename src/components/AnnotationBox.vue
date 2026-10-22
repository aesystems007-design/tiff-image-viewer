<script setup lang="ts">
import { BORDER_COLOR, BORDER_WIDTH_PT, FONT_FAMILY, LINE_HEIGHT, isImageRun, paragraphSize, runStyle, type RichText } from '../annotations/richText'
import AnnotationHtml from './AnnotationHtml.vue'
import AppIcon from './AppIcon.vue'

defineProps<{
  /** Position on screen, in viewer pixels; `minHeight` grows to fit the text. */
  left: number
  top: number
  width: number
  minHeight: number
  text: RichText
  /** Screen pixels per point at the current zoom. */
  pxPerPt: number
  /** HTML drawn instead of the rich text. */
  html?: string | null
  /** Page-pixel size of the box, so HTML pixel sizes match the page. */
  contentWidth: number
  contentHeight: number
  active: boolean
  /** Frame around the box (drawn in on Apply too); an inset shadow, so the text doesn't move. */
  border?: boolean
  /** Overlay fill. Null or omitted leaves the box clear (the active outline still shows). */
  background?: string | null
}>()

const emit = defineEmits<{
  (e: 'press-move', event: PointerEvent): void
  (e: 'press-resize', event: PointerEvent): void
  (e: 'edit'): void
  (e: 'remove'): void
}>()
</script>

<template>
  <div
    class="annotation"
    :class="{ active }"
    :style="{
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      minHeight: `${minHeight}px`,
      fontFamily: FONT_FAMILY,
      lineHeight: LINE_HEIGHT,
      boxShadow: border ? `inset 0 0 0 ${BORDER_WIDTH_PT * pxPerPt}px ${BORDER_COLOR}` : undefined,
      background: background || undefined,
    }"
    title="Annotation (not applied yet): drag to move, double-click to edit"
    @pointerdown.stop="emit('press-move', $event)"
    @dblclick.stop="emit('edit')"
  >
    <AnnotationHtml
      v-if="html"
      :html="html"
      :content-width="contentWidth"
      :content-height="contentHeight"
      :scale="contentWidth > 0 ? width / contentWidth : 1"
    />
    <div
      v-for="(paragraph, i) in html ? [] : text"
      :key="i"
      class="paragraph"
      :style="{ textAlign: paragraph.align, fontSize: `${paragraphSize(paragraph) * pxPerPt}px` }"
    >
      <template v-for="(run, j) in paragraph.runs" :key="j">
        <img
          v-if="isImageRun(run)"
          class="inline-image"
          :src="run.image"
          alt=""
          draggable="false"
          :style="{ width: `${run.width * pxPerPt}px`, height: `${run.height * pxPerPt}px` }"
        />
        <span v-else :style="runStyle(run, pxPerPt)">{{ run.text }}</span>
      </template>
      <br v-if="paragraph.runs.length === 0" />
    </div>
    <template v-if="active">
      <span class="resize" title="Resize" @pointerdown.stop="emit('press-resize', $event)" />
      <div class="tools" @pointerdown.stop @dblclick.stop>
        <button type="button" title="Edit text" aria-label="Edit annotation" @click="emit('edit')">
          <AppIcon name="edit" />
        </button>
        <button type="button" title="Delete annotation (Delete)" aria-label="Delete annotation" @click="emit('remove')">
          <AppIcon name="trash" />
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.annotation {
  position: absolute;
  box-sizing: border-box;
  outline: 1px dashed rgb(47 111 209 / 70%);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  cursor: move;
  pointer-events: auto;
  touch-action: none;
  user-select: none;
}

.annotation.active {
  outline: 2px solid #2f6fd1;
  background: rgb(47 111 209 / 6%);
}

.inline-image {
  vertical-align: middle;
}

.paragraph {
  min-height: 1.2em;
}

.resize {
  position: absolute;
  right: -6px;
  bottom: -6px;
  width: 10px;
  height: 10px;
  border: 1px solid #2f6fd1;
  background: #fff;
  cursor: nwse-resize;
}

.tools {
  position: absolute;
  bottom: calc(100% + 4px);
  right: -2px;
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid #c9d1dd;
  border-radius: 4px;
  background: #fff;
  box-shadow: 0 2px 8px rgb(0 0 0 / 25%);
  cursor: default;
}

.tools button {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 3px;
  background: none;
  color: #1f3a68;
  font-size: 12px;
  cursor: pointer;
}

.tools button:hover {
  background: #e8eef8;
}
</style>
