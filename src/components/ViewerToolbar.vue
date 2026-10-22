<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { actionBrands } from '../host/actionBrand'
import { toolbarButtonShown, type ToolbarButton } from '../host/toolbarButtons'
import { SCALE_STEP, type PaperSize } from '../tiff/pageOps'
import type { FitMode } from '../viewer/fitMode'
import AppIcon from './AppIcon.vue'
import ImageAdjustments from './ImageAdjustments.vue'
import ToolButton from './ToolButton.vue'

const props = defineProps<{
  page: number
  pageCount: number
  busy: boolean
  thumbnailsVisible: boolean
  canUndo: boolean
  hasChanges: boolean
  /** The document came from the server, so Apply saves a new version there. */
  savesToServer: boolean
  fitMode: FitMode | null
  /** The viewer document is showing on the whole screen. */
  fullscreen: boolean
  zoomPercent: number | null
  /** Pages selected in the thumbnail sidebar; "current page" actions apply to all of them. */
  selectedCount: number
  selectAreaActive: boolean
  /** Erase mode: drawing a rectangle erases it. */
  eraseActive: boolean
  /** Reposition mode: dragging on the page moves its content. */
  repositionActive: boolean
  /** False when deleting would leave the document without pages. */
  canDeletePages: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  /** Margin rules are loaded for the document, so there is something to white out. */
  hasMargins: boolean
  /** A deskew is measuring pages. */
  deskewing: boolean
  /** A download file is being written. */
  downloading: boolean
  /** A scan is in progress (Dynamsoft / scanner dialogs open). */
  scanning: boolean
  /** A Dynamsoft product key is set. The scan button is omitted when this is false. */
  canScan: boolean
}>()

const brightness = defineModel<number>('brightness', { required: true })
const contrast = defineModel<number>('contrast', { required: true })

const emit = defineEmits<{
  /** Insert the pages of this file above the selected pages. */
  (e: 'insert-file', file: File): void
  /** Scan pages and insert them above the selected pages. */
  (e: 'scan'): void
  /** Open the download dialog (file name and type). */
  (e: 'download'): void
  (e: 'toggle-thumbnails'): void
  (e: 'toggle-select-area'): void
  (e: 'toggle-erase'): void
  (e: 'toggle-reposition'): void
  /** Despeckles the selected pages (or all pages); every click one level more aggressive. */
  (e: 'despeckle-pages', all: boolean): void
  (e: 'delete-pages'): void
  /** -1 = one place up (towards page 1), +1 = one place down. */
  (e: 'move-pages', direction: -1 | 1): void
  (e: 'undo'): void
  (e: 'print'): void
  /** Scales page content around the center by `step` (+0.05 = 5% bigger) on the selected pages (or all). */
  (e: 'scale-pages', step: number, all: boolean): void
  (e: 'rotate-page', degrees: number): void
  (e: 'rotate-all', degrees: number): void
  (e: 'apply'): void
  (e: 'cancel'): void
  /** Converts the selected pages (or all pages) to a paper size. */
  (e: 'convert-pages', size: PaperSize, all: boolean): void
  /** Fills the margin bands with white on the selected pages (or all pages). */
  (e: 'white-out-margins', all: boolean): void
  /** Measures and straightens the skew of the selected pages (or all pages). */
  (e: 'deskew-pages', all: boolean): void
  (e: 'fit', mode: FitMode): void
  (e: 'toggle-fullscreen'): void
  (e: 'go-to-page', page: number): void
  (e: 'zoom-in'): void
  (e: 'zoom-out'): void
  (e: 'set-zoom', percent: number): void
}>()

/** File types offered when inserting; PDFs are converted to TIFF first. */
const DOCUMENT_TYPES = '.tif,.tiff,image/tiff,.pdf,application/pdf'

const hasDoc = computed(() => props.pageCount > 0)
const canEdit = computed(() => hasDoc.value)
const selectionLabel = computed(() => (props.selectedCount > 1 ? `${props.selectedCount} selected pages` : 'page'))

const pageInput = ref(String(props.page + 1))
const zoomInput = ref('')
const zoomFocused = ref(false)
const insertInput = ref<HTMLInputElement>()

watch(
  () => props.page,
  (page) => (pageInput.value = String(page + 1)),
)

watch(
  () => props.zoomPercent,
  (percent) => {
    if (!zoomFocused.value) zoomInput.value = percent === null ? '' : String(Math.round(percent))
  },
  { immediate: true },
)

function onInsertChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) emit('insert-file', file)
  input.value = ''
}

function commitPageInput() {
  const page = Number.parseInt(pageInput.value, 10)
  if (Number.isFinite(page)) emit('go-to-page', page - 1)
  else pageInput.value = String(props.page + 1)
}

function commitZoomInput() {
  zoomFocused.value = false
  const percent = Number.parseFloat(zoomInput.value)
  if (Number.isFinite(percent) && percent > 0) emit('set-zoom', percent)
  else zoomInput.value = props.zoomPercent === null ? '' : String(Math.round(props.zoomPercent))
}

/** Company colors, when set. Unset fields keep the built-in Apply / Cancel colors. */
function brandStyle(name: 'apply' | 'cancel') {
  const brand = actionBrands[name]
  const style: Record<string, string> = {}
  if (brand.background) style.backgroundColor = brand.background
  if (brand.color) style.color = brand.color
  return style
}

const FILE_BUTTONS = ['undo', 'print', 'download', 'insert', 'scan', 'delete'] as const satisfies readonly ToolbarButton[]
const ROTATE_BUTTONS = ['rotate-left', 'rotate-right', 'rotate-left-all', 'rotate-right-all'] as const satisfies readonly ToolbarButton[]
const EDIT_BUTTONS = [
  'move-down',
  'move-up',
  'select-area',
  'brightness',
  'despeckle',
  'despeckle-all',
  'scale-up',
  'scale-up-all',
  'scale-down',
  'scale-down-all',
] as const satisfies readonly ToolbarButton[]
const ACTION_BUTTONS = ['apply', 'cancel'] as const satisfies readonly ToolbarButton[]
const PAPER_BUTTONS = ['letter', 'letter-all', 'legal', 'legal-all'] as const satisfies readonly ToolbarButton[]
const VIEW_BUTTONS = ['page-nav', 'zoom', 'fit-page', 'fit-width', 'fit-actual', 'fullscreen'] as const satisfies readonly ToolbarButton[]
const MARKUP_BUTTONS = ['white-out', 'white-out-all', 'erase', 'reposition', 'deskew', 'deskew-all'] as const satisfies readonly ToolbarButton[]

/** A company can hide a button. Scan stays hidden until a product key is set, even when this says to show it. */
function shown(name: ToolbarButton): boolean {
  if (name === 'scan' && !props.canScan) return false
  return toolbarButtonShown(name)
}

function anyShown(names: readonly ToolbarButton[]): boolean {
  return names.some((name) => shown(name))
}

const conversions = computed(() =>
  [
    { id: 'letter' as const, size: 'letter' as const, all: false, icon: 'letter' as const, title: `Convert ${selectionLabel.value} to Letter (8.5" × 11")` },
    { id: 'letter-all' as const, size: 'letter' as const, all: true, icon: 'letter' as const, title: 'Convert all pages to Letter (8.5" × 11")' },
    { id: 'legal' as const, size: 'legal' as const, all: false, icon: 'legal' as const, title: `Convert ${selectionLabel.value} to Legal (8.5" × 14")` },
    { id: 'legal-all' as const, size: 'legal' as const, all: true, icon: 'legal' as const, title: 'Convert all pages to Legal (8.5" × 14")' },
  ].filter((item) => shown(item.id)),
)

const fitModes: { mode: FitMode; icon: 'fit-page' | 'fit-width' | 'fit-actual'; title: string }[] = [
  { mode: 'page', icon: 'fit-page', title: 'Best Fit' },
  { mode: 'width', icon: 'fit-width', title: 'Fit Width' },
  { mode: 'actual', icon: 'fit-actual', title: 'Full Size (100%)' },
]
</script>

<template>
  <header class="toolbar">
    <div class="row">
      <ToolButton
        v-if="shown('sidebar')"
        icon="sidebar"
        title="Show/hide thumbnails"
        :active="thumbnailsVisible"
        :disabled="!hasDoc"
        @click="emit('toggle-thumbnails')"
      />
      <span v-if="shown('sidebar') && anyShown([...FILE_BUTTONS, ...ROTATE_BUTTONS, ...EDIT_BUTTONS])" class="divider" />

      <ToolButton v-if="shown('undo')" icon="undo" title="Undo (Ctrl+Z)" :disabled="!canUndo" @click="emit('undo')" />
      <ToolButton v-if="shown('print')" icon="print" title="Print" :disabled="!canEdit || busy" @click="emit('print')" />
      <ToolButton
        v-if="shown('download')"
        icon="download"
        title="Download to PC (PDF or TIFF)"
        :disabled="!canEdit || downloading"
        @click="emit('download')"
      />
      <ToolButton
        v-if="shown('insert')"
        icon="insert"
        :title="`Insert pages from a TIFF or PDF file above the selected ${selectedCount > 1 ? 'pages' : 'page'}`"
        :disabled="!canEdit"
        @click="insertInput?.click()"
      />
      <input v-if="shown('insert')" ref="insertInput" type="file" :accept="DOCUMENT_TYPES" hidden @change="onInsertChosen" />
      <ToolButton
        v-if="shown('scan')"
        icon="scan"
        :title="`Scan pages above the selected ${selectedCount > 1 ? 'pages' : 'page'}`"
        :disabled="!canEdit || scanning"
        @click="emit('scan')"
      />
      <ToolButton
        v-if="shown('delete')"
        icon="trash"
        :title="!hasDoc || canDeletePages ? `Delete ${selectionLabel} (Undo restores)` : 'Cannot delete every page'"
        :disabled="!canEdit || !canDeletePages"
        @click="emit('delete-pages')"
      />
      <span v-if="anyShown(FILE_BUTTONS) && anyShown([...ROTATE_BUTTONS, ...EDIT_BUTTONS])" class="divider" />

      <ToolButton v-if="shown('rotate-left')" icon="rotate-left" :title="`Rotate ${selectionLabel} left`" :disabled="!canEdit" @click="emit('rotate-page', -90)" />
      <ToolButton v-if="shown('rotate-right')" icon="rotate-right" :title="`Rotate ${selectionLabel} right`" :disabled="!canEdit" @click="emit('rotate-page', 90)" />
      <ToolButton v-if="shown('rotate-left-all')" icon="rotate-left" title="Rotate all pages left" large :disabled="!canEdit" @click="emit('rotate-all', -90)" />
      <ToolButton v-if="shown('rotate-right-all')" icon="rotate-right" title="Rotate all pages right" large :disabled="!canEdit" @click="emit('rotate-all', 90)" />
      <span v-if="anyShown(ROTATE_BUTTONS) && anyShown(EDIT_BUTTONS)" class="divider" />

      <ToolButton
        v-if="shown('move-down')"
        icon="move-down"
        :title="`Move ${selectionLabel} down`"
        :disabled="!canMoveDown"
        @click="emit('move-pages', 1)"
      />
      <ToolButton
        v-if="shown('move-up')"
        icon="move-up"
        :title="`Move ${selectionLabel} up`"
        :disabled="!canMoveUp"
        @click="emit('move-pages', -1)"
      />
      <ToolButton
        v-if="shown('select-area')"
        icon="select-area"
        title="Select area: drag on the page (Esc to clear)"
        :active="selectAreaActive"
        :disabled="!canEdit"
        @click="emit('toggle-select-area')"
      />
      <ImageAdjustments v-if="shown('brightness')" v-model:brightness="brightness" v-model:contrast="contrast" :disabled="!hasDoc" />
      <ToolButton
        v-if="shown('despeckle')"
        icon="despeckle"
        :title="`Despeckle ${selectionLabel} (each click removes bigger specks)`"
        :disabled="!canEdit"
        @click="emit('despeckle-pages', false)"
      />
      <ToolButton
        v-if="shown('despeckle-all')"
        icon="despeckle"
        title="Despeckle all pages (each click removes bigger specks)"
        large
        :disabled="!canEdit"
        @click="emit('despeckle-pages', true)"
      />
      <ToolButton
        v-if="shown('scale-up')"
        icon="scale-up"
        :title="`Increase size of ${selectionLabel} (scale up 5%)`"
        :disabled="!canEdit"
        @click="emit('scale-pages', SCALE_STEP, false)"
      />
      <ToolButton
        v-if="shown('scale-up-all')"
        icon="scale-up"
        title="Increase size of all pages (scale up 5%)"
        large
        :disabled="!canEdit"
        @click="emit('scale-pages', SCALE_STEP, true)"
      />
      <ToolButton
        v-if="shown('scale-down')"
        icon="scale-down"
        :title="`Decrease size of ${selectionLabel} (scale down 5%)`"
        :disabled="!canEdit"
        @click="emit('scale-pages', -SCALE_STEP, false)"
      />
      <ToolButton
        v-if="shown('scale-down-all')"
        icon="scale-down"
        title="Decrease size of all pages (scale down 5%)"
        large
        :disabled="!canEdit"
        @click="emit('scale-pages', -SCALE_STEP, true)"
      />

      <span v-if="busy" class="busy"><AppIcon name="spinner" spin /> Loading…</span>
    </div>

    <div class="row">
      <button
        v-if="shown('apply')"
        type="button"
        class="text-button apply"
        :style="brandStyle('apply')"
        :title="actionBrands.apply.title ?? (savesToServer ? 'Apply the changes and save the new version to the server' : 'Apply the changes')"
        :disabled="!hasChanges"
        @click="emit('apply')"
      >
        {{ actionBrands.apply.label ?? 'Apply' }}
      </button>
      <button
        v-if="shown('cancel')"
        type="button"
        class="text-button cancel"
        :style="brandStyle('cancel')"
        :title="actionBrands.cancel.title || undefined"
        :disabled="!hasChanges"
        @click="emit('cancel')"
      >
        {{ actionBrands.cancel.label ?? 'Cancel' }}
      </button>
      <span v-if="anyShown(ACTION_BUTTONS) && anyShown([...PAPER_BUTTONS, ...VIEW_BUTTONS, ...MARKUP_BUTTONS])" class="divider" />

      <ToolButton
        v-for="conversion in conversions"
        :key="conversion.id"
        :icon="conversion.icon"
        :title="conversion.title"
        :large="conversion.all"
        :disabled="!canEdit"
        @click="emit('convert-pages', conversion.size, conversion.all)"
      />
      <span v-if="anyShown(PAPER_BUTTONS) && anyShown([...VIEW_BUTTONS, ...MARKUP_BUTTONS])" class="divider" />

      <div v-if="shown('page-nav')" class="page-nav">
        <button
          type="button"
          class="caret"
          title="Previous page (Page Up)"
          aria-label="Previous page"
          :disabled="page <= 0"
          @click="emit('go-to-page', page - 1)"
        >
          <AppIcon name="caret-left" />
        </button>
        <input
          v-model="pageInput"
          class="box page-input"
          type="text"
          inputmode="numeric"
          aria-label="Page number"
          :disabled="!hasDoc"
          @keydown.enter="commitPageInput"
          @blur="commitPageInput"
        />
        <span>/{{ pageCount }}</span>
        <button
          type="button"
          class="caret"
          title="Next page (Page Down)"
          aria-label="Next page"
          :disabled="page >= pageCount - 1"
          @click="emit('go-to-page', page + 1)"
        >
          <AppIcon name="caret-right" />
        </button>
      </div>

      <div v-if="shown('zoom')" class="box zoom-box" :class="{ disabled: !hasDoc }">
        <input
          v-model="zoomInput"
          class="zoom-input"
          type="text"
          inputmode="decimal"
          aria-label="Zoom percentage"
          :disabled="!hasDoc"
          @focus="zoomFocused = true"
          @keydown.enter="($event.target as HTMLInputElement).blur()"
          @blur="commitZoomInput"
        />
        <span>%</span>
        <ToolButton icon="zoom-in" title="Zoom in (or Ctrl + scroll wheel)" :disabled="!hasDoc" @click="emit('zoom-in')" />
        <ToolButton icon="zoom-out" title="Zoom out (or Ctrl + scroll wheel)" :disabled="!hasDoc" @click="emit('zoom-out')" />
      </div>
      <template v-for="fit in fitModes" :key="fit.mode">
        <ToolButton
          v-if="shown(fit.icon)"
          :icon="fit.icon"
          :title="fit.title"
          :active="hasDoc && fitMode === fit.mode"
          :disabled="!hasDoc"
          @click="emit('fit', fit.mode)"
        />
      </template>
      <ToolButton
        v-if="shown('fullscreen')"
        :icon="fullscreen ? 'fullscreen-exit' : 'fullscreen'"
        :title="fullscreen ? 'Exit full screen (Esc)' : 'Full screen'"
        :active="fullscreen"
        :disabled="!hasDoc && !fullscreen"
        @click="emit('toggle-fullscreen')"
      />
      <span v-if="anyShown(VIEW_BUTTONS) && anyShown(MARKUP_BUTTONS)" class="divider" />

      <ToolButton
        v-if="shown('white-out')"
        icon="white-out"
        :title="hasMargins || !hasDoc ? `White out margins and other areas on ${selectionLabel}` : 'White out margins (no margins for this document)'"
        :disabled="!canEdit || !hasMargins"
        @click="emit('white-out-margins', false)"
      />
      <ToolButton
        v-if="shown('white-out-all')"
        icon="white-out"
        :title="hasMargins || !hasDoc ? 'White out margins and other areas on all pages' : 'White out margins on all pages (no margins for this document)'"
        large
        :disabled="!canEdit || !hasMargins"
        @click="emit('white-out-margins', true)"
      />
      <ToolButton
        v-if="shown('erase')"
        icon="eraser"
        title="Erase: drag a rectangle on the page to erase it (Esc to stop)"
        :active="eraseActive"
        :disabled="!canEdit"
        @click="emit('toggle-erase')"
      />
      <ToolButton
        v-if="shown('reposition')"
        icon="reposition"
        title="Reposition: drag the page content to move it, or use the arrow keys (Esc to stop)"
        :active="repositionActive"
        :disabled="!canEdit"
        @click="emit('toggle-reposition')"
      />
      <ToolButton
        v-if="shown('deskew')"
        icon="deskew"
        tilt
        :title="`Deskew ${selectionLabel}`"
        :disabled="!canEdit || deskewing"
        @click="emit('deskew-pages', false)"
      />
      <ToolButton
        v-if="shown('deskew-all')"
        icon="deskew"
        tilt
        title="Deskew all pages"
        large
        :disabled="!canEdit || deskewing"
        @click="emit('deskew-pages', true)"
      />
    </div>
  </header>
</template>

<style scoped>
.toolbar {
  position: relative;
  --toolbar-icon: #1f3a68;
  --toolbar-icon-strong: #27498c;
  --toolbar-hover: #e8eef8;
  --toolbar-border: #c9d1dd;

  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.35rem 0.6rem;
  background: #fff;
  color: #1d2635;
  border-bottom: 1px solid var(--toolbar-border);
  user-select: none;
}

/* Deskew icons are drawn slightly tilted. */
.toolbar :deep(.skewed) {
  rotate: -12deg;
}

.row {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  min-height: 2.25rem;
  flex-wrap: wrap;
}

.divider {
  width: 1px;
  height: 1.5rem;
  margin: 0 0.25rem;
  background: var(--toolbar-border);
}

/* Overlaid at the right end of row 1 so it never wraps the row. */
.busy {
  position: absolute;
  top: 0.35rem;
  right: 0.6rem;
  padding-left: 0.5rem;
  background: #fff;
  color: #4a5568;
  line-height: 2.25rem;
  white-space: nowrap;
}

.text-button {
  height: 2rem;
  padding: 0 0.75rem;
  border: none;
  border-radius: 4px;
  color: #fff;
  font: inherit;
  font-size: 1rem;
  cursor: pointer;
}

.text-button.apply {
  background: #3d64b5;
}

.text-button.cancel {
  margin-left: 0.25rem;
  background: #6b7686;
}

.text-button:hover:not(:disabled) {
  filter: brightness(1.1);
}

.text-button:disabled {
  opacity: 0.55;
  cursor: default;
}

.box {
  box-sizing: border-box;
  height: 1.75rem;
  border: 1px solid #1d2635;
  border-radius: 6px;
  background: #fff;
  color: inherit;
  font: inherit;
  font-size: 0.9rem;
}

.page-nav {
  display: flex;
  align-items: center;
  gap: 0.1rem;
  font-size: 0.9rem;
  white-space: nowrap;
}

.page-input {
  width: 2.5rem;
  padding: 0 0.2rem;
  text-align: center;
}

.caret {
  width: 1rem;
  height: 2rem;
  padding: 0;
  border: none;
  background: none;
  color: var(--toolbar-icon);
  font-size: 0.9rem;
  cursor: pointer;
}

.caret:disabled {
  opacity: 0.3;
  cursor: default;
}

.zoom-box {
  display: flex;
  align-items: center;
  margin-left: 0.25rem;
  padding: 0 0 0 0.3rem;
}

.zoom-box.disabled {
  opacity: 0.5;
}

.zoom-box :deep(.tool) {
  width: 1.5rem;
  height: 1.5rem;
  font-size: 0.9rem;
}

.zoom-input {
  width: 2rem;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: right;
  outline: none;
}

input:disabled {
  background: transparent;
}
</style>
