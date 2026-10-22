<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'

const props = defineProps<{
  /** Sanitized HTML. */
  html: string
  /** Page-pixel size the HTML was authored in. */
  contentWidth: number
  contentHeight: number
  /** Screen pixels per page pixel, so the markup scales with the page. */
  scale: number
}>()

const host = ref<HTMLElement>()

/** CSS stays inside the shadow root, so a `<style>` in the annotation does not restyle the viewer. */
function paint() {
  const el = host.value
  if (!el) return
  const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' })
  const width = Math.max(1, props.contentWidth)
  const height = Math.max(1, props.contentHeight)
  const scale = props.scale > 0 ? props.scale : 1
  root.innerHTML =
    `<style>:host{display:block;pointer-events:none} img{max-width:100%}</style>` +
    `<div style="width:${width}px;height:${height}px;transform:scale(${scale});transform-origin:top left;overflow:hidden;box-sizing:border-box">${props.html}</div>`
}

onMounted(paint)
watch(() => [props.html, props.contentWidth, props.contentHeight, props.scale], paint)
</script>

<template>
  <div ref="host" class="annotation-html" />
</template>

<style scoped>
.annotation-html {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}
</style>
