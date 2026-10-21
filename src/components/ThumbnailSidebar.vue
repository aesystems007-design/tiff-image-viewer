<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { movePagesBefore } from '../composables/usePageEdits'
import { opsKey, type PageOp } from '../tiff/pageOps'
import type { PageInfo } from '../tiff/protocol'
import type { TiffDocument } from '../tiff/TiffDocument'
import type { PageGuide } from '../viewer/pageGuide'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  doc: TiffDocument
  page: number
  /** Indexes of the pages to list (deleted pages left out), in document order. */
  pages: readonly number[]
  /** Clockwise rotation per page, in degrees. */
  rotations: readonly number[]
  /** Pixel edits per page; thumbnails show the edited page. */
  ops: readonly (readonly PageOp[])[]
  /** Page sizes with edits applied (paper-size conversions change them). */
  pageInfos: readonly PageInfo[]
  /** Margins / keep-clear areas per page (page pixels), same as drawn in the viewer. */
  guides: readonly (readonly PageGuide[])[]
  /** Pages that currently have an image warning (margin / keep-clear overlap). */
  warningPages?: ReadonlySet<number>
  selected: ReadonlySet<number>
  /** Pages deleted by the user (pending; Undo / Cancel restore them). */
  deletedCount: number
  /** Pages can't be reordered by dragging (uneditable annotations are being placed). */
  locked?: boolean
}>()

const emit = defineEmits<{
  (e: 'select', page: number, modifiers: { ctrl: boolean; shift: boolean }): void
  (e: 'select-all'): void
  (e: 'clear-selection'): void
  /** Drag & drop: move `pages` (display order) before page `before`, or to the end when null. */
  (e: 'move', pages: number[], before: number | null): void
}>()

function onThumbClick(index: number, event: MouseEvent) {
  emit('select', index, { ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey })
}

/** The checkbox behaves like Ctrl+click: toggle without clearing the rest (Shift adds a range). */
function onCheckClick(index: number, event: MouseEvent) {
  emit('select', index, { ctrl: true, shift: event.shiftKey })
}

// Shift/Ctrl+mousedown would start or extend a browser text selection across the whole page.
function onMouseDown(event: MouseEvent) {
  if (event.shiftKey || event.ctrlKey || event.metaKey) event.preventDefault()
}

function onKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
    event.preventDefault()
    emit('select-all')
  } else if (event.key === 'Escape') {
    emit('clear-selection')
  }
}

const DRAG_TYPE = 'application/x-tiff-pages'
/** Distance from the list's top / bottom edge (px) where a drag scrolls the list. */
const DRAG_SCROLL_EDGE = 40

/** Pages being dragged: the selection when a selected thumbnail is dragged, else just that page. */
const dragPages = ref<number[] | null>(null)
/** Position in `pages` the dragged pages would be dropped before (`pages.length` = the end); null = no move. */
const dropPosition = ref<number | null>(null)

function onDragStart(index: number, event: DragEvent) {
  if (!event.dataTransfer || props.locked) return
  dragPages.value = props.selected.has(index) ? props.pages.filter((page) => props.selected.has(page)) : [index]
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData(DRAG_TYPE, dragPages.value.join(','))
}

function onDragOver(event: DragEvent) {
  if (!dragPages.value || !list.value) return
  event.preventDefault()
  event.stopPropagation()
  const items = [...list.value.querySelectorAll<HTMLElement>(':scope > li')]
  let position = items.findIndex((item) => {
    const rect = item.getBoundingClientRect()
    return event.clientY < rect.top + rect.height / 2
  })
  if (position < 0) position = items.length
  const moves = movePagesBefore(props.pages, new Set(dragPages.value), props.pages[position] ?? null) !== null
  dropPosition.value = moves ? position : null
  if (event.dataTransfer) event.dataTransfer.dropEffect = moves ? 'move' : 'none'

  const bounds = list.value.getBoundingClientRect()
  if (event.clientY < bounds.top + DRAG_SCROLL_EDGE) list.value.scrollTop -= 12
  else if (event.clientY > bounds.bottom - DRAG_SCROLL_EDGE) list.value.scrollTop += 12
}

function onDragLeave(event: DragEvent) {
  if (!list.value?.contains(event.relatedTarget as Node | null)) dropPosition.value = null
}

function onDrop(event: DragEvent) {
  if (!dragPages.value) return
  event.preventDefault()
  event.stopPropagation()
  if (dropPosition.value !== null) emit('move', dragPages.value, props.pages[dropPosition.value] ?? null)
  endDrag()
}

function endDrag() {
  dragPages.value = null
  dropPosition.value = null
}

const list = ref<HTMLOListElement>()
const urls = ref<Record<number, string>>({})
const failed = ref<Record<number, boolean>>({})
/** Edit state each loaded thumbnail was requested for; only pages that have been scrolled into view are present. */
const requestedKeys = new Map<number, string>()
let observer: IntersectionObserver | null = null

function load(page: number) {
  const ops = props.ops[page] ?? []
  const key = opsKey(ops)
  requestedKeys.set(page, key)
  props.doc
    .getThumbnailUrl(page, ops)
    .then((url) => {
      // Keep showing the previous thumbnail if a newer edit was requested meanwhile.
      if (requestedKeys.get(page) === key) urls.value[page] = url
    })
    .catch(() => (failed.value[page] = true))
}

// Refresh thumbnails whose page was edited (only those already loaded; the rest load on scroll).
watch(
  () => props.ops,
  (ops) => {
    for (const [page, key] of requestedKeys) {
      if (opsKey(ops[page] ?? []) !== key) load(page)
    }
  },
)

/**
 * The frame takes the rotated page's shape; the image keeps its own shape (sized as a
 * percentage of the frame) and is rotated about the frame's centre.
 */
function frameStyle(index: number) {
  const { width, height } = props.pageInfos[index]
  const w = width || 1
  const h = height || 1
  const sideways = (props.rotations[index] ?? 0) % 180 !== 0
  return { '--ar': String(sideways ? h / w : w / h) }
}

/** Guides are in page pixels; as percentages of the unrotated page they rotate along with the image. */
function guideStyle(index: number, { rect }: PageGuide) {
  const { width, height } = props.pageInfos[index]
  const w = width || 1
  const h = height || 1
  return {
    left: `${(rect.x / w) * 100}%`,
    top: `${(rect.y / h) * 100}%`,
    width: `${(rect.width / w) * 100}%`,
    height: `${(rect.height / h) * 100}%`,
  }
}

function imageStyle(index: number) {
  const { width, height } = props.pageInfos[index]
  const w = width || 1
  const h = height || 1
  const rotation = props.rotations[index] ?? 0
  const sideways = rotation % 180 !== 0
  return {
    width: sideways ? `${(w / h) * 100}%` : '100%',
    height: sideways ? `${(h / w) * 100}%` : '100%',
    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
  }
}

function scrollToCurrent() {
  list.value?.querySelector(`[data-page="${props.page}"]`)?.scrollIntoView({ block: 'nearest' })
}

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        observer?.unobserve(entry.target)
        load(Number((entry.target as HTMLElement).dataset.page))
      }
    },
    { root: list.value, rootMargin: '300px 0px' },
  )
  observeUnloaded()
  nextTick(scrollToCurrent)
})

/** Starts lazy loading for listed thumbnails that were never requested (e.g. pages restored by Undo). */
function observeUnloaded() {
  list.value?.querySelectorAll<HTMLElement>('[data-page]').forEach((el) => {
    if (!requestedKeys.has(Number(el.dataset.page))) observer?.observe(el)
  })
}

watch(
  () => props.pages,
  () => {
    observeUnloaded()
    scrollToCurrent()
  },
  { flush: 'post' },
)

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})

watch(() => props.page, scrollToCurrent, { flush: 'post' })
</script>

<template>
  <aside class="sidebar" :class="{ multi: selected.size > 1 }" @keydown="onKeydown" @mousedown="onMouseDown">
    <div class="header">
      {{ pages.length }} {{ pages.length === 1 ? 'page' : 'pages' }}
      <span v-if="selected.size > 1" class="selection-count">{{ selected.size }} selected</span>
      <span v-if="deletedCount > 0" class="deleted-count" title="Undo or Cancel restores deleted pages">
        {{ deletedCount }} deleted
      </span>
    </div>
    <ol ref="list" class="thumbs" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
      <li
        v-for="(index, position) in pages"
        :key="index"
        :data-page="index"
        :class="{
          dragging: dragPages?.includes(index),
          'drop-before': dropPosition === position,
          'drop-after': dropPosition === pages.length && position === pages.length - 1,
        }"
        :draggable="!locked"
        @dragstart="onDragStart(index, $event)"
        @dragend="endDrag"
      >
        <button
          type="button"
          class="check"
          role="checkbox"
          :aria-checked="selected.has(index)"
          :aria-label="`Select page ${position + 1}`"
          :title="selected.has(index) ? 'Remove from selection' : 'Add to selection'"
          @click="onCheckClick(index, $event)"
        >
          <AppIcon :name="selected.has(index) ? 'checkbox-on' : 'checkbox'" />
        </button>
        <button
          type="button"
          class="thumb"
          :class="{ selected: selected.has(index), current: index === page }"
          :title="`Page ${position + 1} (Ctrl+click to add, Shift+click for a range${locked ? '' : ', drag to move'})`"
          :aria-pressed="selected.has(index)"
          :aria-current="index === page ? 'page' : undefined"
          @click="onThumbClick(index, $event)"
        >
          <span class="frame" :style="frameStyle(index)">
            <span v-if="urls[index]" class="page" :style="imageStyle(index)">
              <img :src="urls[index]" alt="" draggable="false" />
              <span
                v-for="(guide, i) in guides[index] ?? []"
                :key="i"
                class="guide"
                :class="guide.kind"
                :style="guideStyle(index, guide)"
              />
            </span>
            <span v-else-if="failed[index]" class="placeholder">!</span>
          </span>
          <span class="label">
            {{ position + 1 }}
            <AppIcon
              v-if="warningPages?.has(index)"
              class="warn"
              name="warning"
              title="This page has an image warning"
              aria-label="Image warning"
            />
          </span>
        </button>
      </li>
    </ol>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  width: 156px;
  flex-shrink: 0;
  background: #fff;
  border-right: 1px solid #c9d1dd;
  color-scheme: light;
  user-select: none;
}

.thumbs li {
  position: relative;
}

.thumbs li.dragging .thumb {
  opacity: 0.4;
}

/* Insertion line in the gap above (or below the last) thumbnail where the dragged pages will land. */
.thumbs li.drop-before::before,
.thumbs li.drop-after::after {
  content: '';
  position: absolute;
  left: 0.35rem;
  right: 0.35rem;
  height: 4px;
  border-radius: 2px;
  background: #2f6fd1;
  pointer-events: none;
}

.thumbs li.drop-before::before {
  top: calc(-0.375rem - 2px);
}

.thumbs li.drop-after::after {
  bottom: calc(-0.375rem - 2px);
}

.check {
  position: absolute;
  top: 0.45rem;
  left: 0.45rem;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.4rem;
  height: 1.4rem;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: rgb(255 255 255 / 85%);
  color: #6b7686;
  font-size: 1rem;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.1s;
}

.check[aria-checked='true'] {
  color: #2f6fd1;
}

/* Show on hover/focus, and always while several pages are selected. */
.thumbs li:hover .check,
.check:focus-visible,
.sidebar.multi .check {
  opacity: 1;
}

.header {
  display: flex;
  flex-direction: column;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid #c9d1dd;
  font-size: 0.85em;
  opacity: 0.85;
}

.selection-count {
  color: #2f6fd1;
}

.deleted-count {
  color: #b03a3a;
}

.thumbs {
  flex: 1;
  margin: 0;
  padding: 0.75rem;
  overflow-y: auto;
  list-style: none;
}

.thumbs li + li {
  margin-top: 0.75rem;
}

.thumb {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
  width: 100%;
  padding: 0.35rem;
  border: 2px solid transparent;
  border-radius: 6px;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.thumb:hover {
  background: #f0f3f8;
}

.thumb.selected {
  border-color: #2f6fd1;
  background: #e8eef8;
}

.thumb.current .label {
  padding: 0 0.45rem;
  border-radius: 999px;
  background: #2f6fd1;
  color: #fff;
  opacity: 1;
}

.frame {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Width shrinks for very tall pages so the frame never exceeds 180px high. */
  width: min(100%, calc(180px * var(--ar)));
  aspect-ratio: var(--ar);
  background: #f4f6f9;
  box-shadow: 0 0 0 1px #c9d1dd;
  overflow: hidden;
}

.page {
  position: absolute;
  top: 50%;
  left: 50%;
  display: block;
  transition: transform 0.2s ease;
}

.page img {
  display: block;
  width: 100%;
  height: 100%;
}

.guide {
  position: absolute;
  pointer-events: none;
}

.guide.margin {
  background: rgb(150 150 150 / 35%);
}

.guide.keep-clear {
  background: rgb(150 150 150 / 25%);
  outline: 1px dashed rgb(110 110 110 / 85%);
  outline-offset: -1px;
}

.placeholder {
  opacity: 0.6;
}

.label {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.85em;
  opacity: 0.8;
}

.label .warn {
  color: #c58a0a;
  font-size: 0.75em;
  opacity: 1;
}
</style>
