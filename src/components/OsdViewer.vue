<script setup lang="ts">
import OpenSeadragon from 'openseadragon'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { Annotation } from '../annotations/annotation'
import type { ImageRun } from '../annotations/richText'
import AnnotationBox from './AnnotationBox.vue'
import UneditableAnnotationBox from './UneditableAnnotationBox.vue'
import type { UneditableAnnotation } from '../host/uneditableAnnotation'
import type { FitMode } from '../viewer/fitMode'
import type { ImageRect } from '../viewer/imageRect'
import type { PageGuide } from '../viewer/pageGuide'
import { HANDLES, useAreaSelection, type ScreenRect } from '../viewer/useAreaSelection'

const props = defineProps<{
  /** URL of the image to display, or null for an empty viewer. */
  url: string | null
  /**
   * Identifies the page being shown. A new URL with the same key is a re-render of the same page
   * (after an edit): the image is swapped in place, keeping zoom, position and the area selection.
   */
  pageKey: string
  /** Clockwise rotation of the current page, in degrees. */
  rotation: number
  /** Re-applied whenever a page opens or rotates. Null keeps the current zoom when rotating. */
  fitMode: FitMode | null
  /** CSS filter for the rendered image, e.g. brightness/contrast. */
  imageFilter: string
  /** While true, dragging on the page draws an area selection instead of panning. */
  selectMode: boolean
  /** While true, dragging on the page draws a rectangle that is erased on release (emits `erase-area`). */
  eraseMode?: boolean
  /** While true, dragging on the page moves its content (previewed live; emits `reposition` on release). */
  repositionMode?: boolean
  /** CSS filter previewed on the selected area only (e.g. contrast before it's applied). */
  selectionFilter?: string | null
  /** Margins and keep-clear areas drawn over the current page (page pixels). */
  guides?: readonly PageGuide[]
  /** Pending annotations on the current page; `pxPerPt` = page pixels per point. */
  annotations?: readonly (Annotation & { pxPerPt: number })[]
  /** Id of the selected annotation (shows its handle and tools). */
  activeAnnotation?: number | null
  /** Shows the annotations without letting them be selected, moved or edited. */
  annotationsLocked?: boolean
  /**
   * Uneditable annotations from the host on the current page: can only be moved, and not at all once `applied`.
   * `pagePxPerDpi` sizes their text.
   */
  uneditableAnnotations?: readonly {
    id: number
    rect: ImageRect
    annotation: UneditableAnnotation
    /** Picture inline with the label. */
    imageRun: ImageRun | null
    /** Page pixels per point. */
    pxPerPt: number
    applied: boolean
    pagePxPerDpi: number
  }[]
}>()

defineSlots<{
  /** Actions shown under the selected area. */
  'selection-actions'?: () => unknown
}>()

/** Selected area of the current page, in page pixels. Cleared on page change and when select mode ends. */
const selection = defineModel<ImageRect | null>('selection', { default: null })

const emit = defineEmits<{
  (e: 'open-failed', message: string): void
  (e: 'zoom-change', percent: number): void
  /** Scroll wheel without Ctrl: +1 = next page, -1 = previous page. */
  (e: 'page-scroll', direction: 1 | -1): void
  /** The user zoomed with Ctrl + scroll wheel. */
  (e: 'user-zoom'): void
  /** A rectangle was drawn in erase mode (page pixels). */
  (e: 'erase-area', rect: ImageRect): void
  /** The page content was dragged in reposition mode by `dx`, `dy` page pixels (unrotated page). */
  (e: 'reposition', dx: number, dy: number): void
  /** An annotation was clicked (or null: the page was clicked). */
  (e: 'annotation-select', id: number | null): void
  /** An annotation was moved or resized (emitted once, when the drag ends). */
  (e: 'annotation-change', id: number, rect: ImageRect): void
  (e: 'annotation-edit', id: number): void
  (e: 'annotation-remove', id: number): void
  /** An uneditable annotation was moved (emitted once, when the drag ends). */
  (e: 'uneditable-annotation-move', id: number, rect: ImageRect): void
}>()

/** Scroll distance (px) per page turn: one mouse-wheel notch, or a short trackpad swipe. */
const PAGE_SCROLL_DISTANCE = 100
/** Minimum time between page turns so a fast spin doesn't skip pages before they render. */
const PAGE_SCROLL_COOLDOWN_MS = 150

/** When scrolling within a page reaches its edge, the page stays put this long before the wheel turns it. */
const EDGE_PAUSE_MS = 300
/** A page that opens this soon after a wheel page turn was opened by it (and starts at `enterEdge`). */
const WHEEL_TURN_OPEN_MS = 2000

let scrollAccumulated = 0
let lastPageScroll = 0
let lastScrollWithinPage = 0

type Edge = 'top' | 'bottom'
/** Edge of the next page to show first when it's taller than the view (bottom when scrolling back). */
let enterEdge: Edge = 'top'

function wheelDeltaPixels(event: WheelEvent, delta: number): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * 40
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * 800
  return delta
}

/** Shift + wheel (or a sideways trackpad swipe) scrolls across; returns that distance, or 0 for a vertical scroll. */
function horizontalWheel(wheel: WheelEvent): number {
  if (wheel.shiftKey) return wheelDeltaPixels(wheel, wheel.deltaX || wheel.deltaY)
  return Math.abs(wheel.deltaX) > Math.abs(wheel.deltaY) ? wheelDeltaPixels(wheel, wheel.deltaX) : 0
}

/**
 * The wheel scrolls the stage (`.osd-wrap`) when the canvas-container is larger than it; at the top or
 * bottom edge it turns the page. Ctrl + wheel scales the canvas-container (image stays fitted inside it).
 */
function onCanvasScroll(event: OpenSeadragon.CanvasScrollEvent) {
  const wheel = event.originalEvent as WheelEvent
  event.preventDefaultAction = true
  const now = performance.now()

  if (wheel.ctrlKey || wheel.metaKey) {
    scaleCanvas(wheel.deltaY < 0 || event.scroll > 0 ? 1.1 : 1 / 1.1)
    return
  }

  const wrap = wrapEl.value
  const across = horizontalWheel(wheel)
  if (across && wrap) {
    const before = wrap.scrollLeft
    wrap.scrollLeft += across
    if (wrap.scrollLeft !== before) {
      scrollAccumulated = 0
      lastScrollWithinPage = now
      return
    }
  }

  const delta = Number.isFinite(wheel.deltaY) ? wheelDeltaPixels(wheel, wheel.deltaY) : -event.scroll * PAGE_SCROLL_DISTANCE
  if (wrap) {
    const before = wrap.scrollTop
    wrap.scrollTop += delta
    if (wrap.scrollTop !== before) {
      scrollAccumulated = 0
      lastScrollWithinPage = now
      return
    }
  }

  if (now - lastScrollWithinPage < EDGE_PAUSE_MS) return
  if (Math.sign(delta) !== Math.sign(scrollAccumulated)) scrollAccumulated = 0
  scrollAccumulated += delta
  if (Math.abs(scrollAccumulated) < PAGE_SCROLL_DISTANCE) return

  const direction = scrollAccumulated > 0 ? 1 : -1
  scrollAccumulated = 0
  if (now - lastPageScroll < PAGE_SCROLL_COOLDOWN_MS) return
  lastPageScroll = now
  enterEdge = direction > 0 ? 'top' : 'bottom'
  emit('page-scroll', direction)
}

/** Black border around `.canvas-container` (drawn outside the image area). */
const CANVAS_BORDER = 1

// The typings omit the `immediately` flag that Viewport.setRotation accepts at runtime,
// and the `current` flag (true = mid-animation value, false = target) of getRotation and TiledImage.getBounds.
type RotatableViewport = {
  setRotation(degrees: number, immediately?: boolean): void
  getRotation(current?: boolean): number
}

const wrapEl = ref<HTMLDivElement>()
const container = ref<HTMLDivElement>()
let viewer: OpenSeadragon.Viewer | null = null
/** Unrotated page size in image pixels (from the opened tile source). */
const pagePixels = ref<{ width: number; height: number } | null>(null)
/** CSS pixels per image pixel when not in a sticky fit mode (1 = Full Size). */
const manualScale = ref(1)
const wrapSize = ref({ width: 0, height: 0 })
let wrapObserver: ResizeObserver | null = null

/** Page size as shown on screen (rotation swaps sides). */
const displayPage = computed(() => {
  const page = pagePixels.value
  if (!page) return null
  const sideways = ((props.rotation % 360) + 360) % 180 !== 0
  return sideways ? { width: page.height, height: page.width } : { width: page.width, height: page.height }
})

/**
 * Size of `.canvas-container` in CSS pixels. Driven by `wrapSize` (ResizeObserver on `.osd-wrap`) and
 * the sticky fit mode / manual zoom:
 * - Fit Width: width ≈ wrap width (minus the 1px black border); height follows page aspect (stage scrolls).
 * - Best Fit: largest size that fits in wrap width and height.
 * - Full Size / zoom: page pixels × scale (may be larger than the wrap).
 */
const canvasSize = computed(() => {
  const page = displayPage.value
  const wrap = wrapSize.value
  if (!page || wrap.width <= 0) return null
  const availW = Math.max(1, wrap.width)
  const availH = Math.max(1, wrap.height)
  const mode = props.fitMode
  if (mode === 'width') {
    // Fill the stage width. `.osd-wrap.fit-width` keeps a stable vertical scrollbar gutter and
    // hides overflow-x, so the gutter appearing never changes this width (that loop flickered the page).
    // Floor so sub-pixels do not spill past the wrap.
    const width = Math.max(1, Math.floor(availW - CANVAS_BORDER * 2))
    const height = Math.floor((width * page.height) / page.width)
    return { width, height }
  }
  if (mode === 'page') {
    const innerW = availW - CANVAS_BORDER * 2
    const innerH = availH - CANVAS_BORDER * 2
    const scale = Math.min(innerW / page.width, innerH / page.height)
    return { width: Math.floor(page.width * scale), height: Math.floor(page.height * scale) }
  }
  if (mode === 'actual') return { width: page.width, height: page.height }
  return { width: page.width * manualScale.value, height: page.height * manualScale.value }
})

const canvasContainerStyle = computed(() => {
  const size = canvasSize.value
  if (!size) return { width: '0px', height: '0px' }
  return { width: `${size.width}px`, height: `${size.height}px` }
})

/** Scale the canvas-container (and re-fit the image into it). Used for zoom ± and Ctrl + wheel. */
function scaleCanvas(factor: number) {
  const page = displayPage.value
  const size = canvasSize.value
  if (!page || !size) return
  // Capture the current on-screen scale before leaving a sticky fit mode.
  manualScale.value = Math.min(8, Math.max(0.05, (size.width / page.width) * factor))
  emit('user-zoom')
  void nextTick(() => syncCanvas(true))
}

/** Drops overlapping syncCanvas runs (Cancel after Rotate all used to apply a stale fit). */
let syncToken = 0

/** Apply the canvas-container size and fit the page image into it (home bounds fill the box). */
async function syncCanvas(immediately = true) {
  const token = ++syncToken
  await nextTick()
  // One more frame so the canvas-container's CSS width/height from `canvasSize` is on the element.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  if (token !== syncToken) return
  if (!viewer || !hasImage()) return
  const element = container.value
  // A hidden viewer (inactive tab) is ~1×1 px; fitting then would give a broken zoom.
  if (!element || element.clientWidth < 2 || element.clientHeight < 2) return
  const image = item()
  const page = displayPage.value
  const size = canvasSize.value
  if (!image || !page || !size) return
  // Keep OSD's angle on the prop before measuring zoom (displayPage assumes this rotation).
  const current = viewer.viewport.getRotation()
  const delta = ((((props.rotation - current) % 360) + 540) % 360) - 180
  if (Math.abs(delta) >= 1e-6) setRotation(current + delta, true)
  // Use the computed fit size (same source as the container's style), not clientWidth/Height —
  // after Cancel/Undo those can still be the pre-rotation box for a frame and leave Fit Width wrong.
  ;(viewer.viewport as unknown as { resize(size: OpenSeadragon.Point, maintain: boolean): void }).resize(
    new OpenSeadragon.Point(size.width, size.height),
    false,
  )
  // Scale the page image into the canvas-container (old viewer: draw into a sized canvas).
  // imageToViewportZoom(cssScale) makes one image pixel cover `cssScale` CSS pixels on screen.
  // `page` is the displayed (rotation-swapped) size, so this fills the box at any multiple of 90°.
  const cssScale = Math.min(size.width / page.width, size.height / page.height)
  viewer.viewport.zoomTo(image.imageToViewportZoom(cssScale), undefined, immediately)
  viewer.viewport.panTo(viewer.world.getHomeBounds().getCenter(), immediately)
  if (token !== syncToken) return
  emit('zoom-change', (size.width / page.width) * 100)
}

const area = useAreaSelection({
  getViewer: () => viewer,
  container,
  isActive: () => props.selectMode,
  selection,
})
const selectionBox = area.screenRect

/** Rectangle being drawn in erase mode; erased (and cleared) when the drag ends. */
const eraseRect = ref<ImageRect | null>(null)
const eraseArea = useAreaSelection({
  getViewer: () => viewer,
  container,
  isActive: () => !!props.eraseMode,
  selection: eraseRect,
  onDrawEnd: (rect) => {
    emit('erase-area', { ...rect })
    eraseRect.value = null
  },
})
const eraseBox = eraseArea.screenRect
watch(eraseRect, eraseArea.refresh)

/** Drags shorter than this (screen px) don't move the content. */
const MIN_REPOSITION_PX = 4
/** How long the preview waits for the re-rendered page before giving up (e.g. when nothing changed). */
const REPOSITION_PREVIEW_MS = 5000

/**
 * Content drag in reposition mode: where it started (screen and page pixels) and how far the pointer has moved
 * on screen. After release it stays (with `released`) until the re-rendered page replaces the old one.
 */
const repositionDrag = shallowRef<{
  screen: OpenSeadragon.Point
  image: OpenSeadragon.Point
  offset: { x: number; y: number }
  released: boolean
} | null>(null)
let repositionTimer: number | undefined

function endRepositionPreview() {
  window.clearTimeout(repositionTimer)
  repositionDrag.value = null
}

/** The page as it will look after the drag: its image moved by the drag offset, clipped to the page, on white. */
const repositionPreview = computed(() => {
  void viewportTick.value
  const drag = repositionDrag.value
  const image = item()
  const size = image?.getContentSize()
  if (!drag || !viewer || !image || !size || !props.url) return null
  const a = image.imageToViewerElementCoordinates(new OpenSeadragon.Point(0, 0))
  const b = image.imageToViewerElementCoordinates(new OpenSeadragon.Point(size.x, size.y))
  const scale = image.viewportToImageZoom(viewer.viewport.getZoom(true))
  return {
    page: {
      left: `${Math.min(a.x, b.x)}px`,
      top: `${Math.min(a.y, b.y)}px`,
      width: `${Math.abs(b.x - a.x)}px`,
      height: `${Math.abs(b.y - a.y)}px`,
    },
    image: {
      width: `${size.x * scale}px`,
      height: `${size.y * scale}px`,
      transform: `translate(${drag.offset.x}px, ${drag.offset.y}px) translate(-50%, -50%) rotate(${props.rotation}deg)`,
    },
  }
})

function attachReposition(osd: OpenSeadragon.Viewer) {
  osd.addHandler('canvas-press', (event) => {
    if (!props.repositionMode) return
    const image = viewerToImage(event.position.x, event.position.y)
    endRepositionPreview()
    if (image) repositionDrag.value = { screen: event.position, image, offset: { x: 0, y: 0 }, released: false }
  })
  osd.addHandler('canvas-drag', (event) => {
    if (!props.repositionMode) return
    event.preventDefaultAction = true
    const drag = repositionDrag.value
    if (!drag || drag.released) return
    repositionDrag.value = { ...drag, offset: { x: event.position.x - drag.screen.x, y: event.position.y - drag.screen.y } }
  })
  osd.addHandler('canvas-drag-end', (event) => {
    if (props.repositionMode) event.preventDefaultAction = true
  })
  osd.addHandler('canvas-release', () => {
    const drag = repositionDrag.value
    if (!drag || drag.released) return
    const { x, y } = drag.offset
    const end = Math.hypot(x, y) >= MIN_REPOSITION_PX ? viewerToImage(drag.screen.x + x, drag.screen.y + y) : null
    const dx = end ? Math.round(end.x - drag.image.x) : 0
    const dy = end ? Math.round(end.y - drag.image.y) : 0
    if (dx === 0 && dy === 0) {
      endRepositionPreview()
      return
    }
    // Keep showing the preview until the moved page is drawn, so the old position doesn't flash back.
    repositionDrag.value = { ...drag, released: true }
    repositionTimer = window.setTimeout(endRepositionPreview, REPOSITION_PREVIEW_MS)
    emit('reposition', dx, dy)
  })
  // Arrow keys nudge the content (handled by the app) instead of panning.
  osd.addHandler('canvas-key', (event) => {
    const key = (event.originalEvent as KeyboardEvent).key
    if (props.repositionMode && key.startsWith('Arrow')) event.preventDefaultAction = true
  })
}

watch(
  () => props.repositionMode,
  (active) => {
    if (!active && !repositionDrag.value?.released) endRepositionPreview()
  },
)

/** Room for the action bar below the box; otherwise it's tucked inside the bottom edge. */
const actionsBelow = computed(() => {
  const box = selectionBox.value
  return !!box && box.bottom + 48 < (container.value?.clientHeight ?? 0)
})

const ACTIONS_MARGIN = 8
const actionsEl = ref<HTMLDivElement>()
const actionsWidth = ref(0)
const actionsObserver = new ResizeObserver(([entry]) => (actionsWidth.value = (entry.target as HTMLElement).offsetWidth))
watch(actionsEl, (el, previous) => {
  if (previous) actionsObserver.unobserve(previous)
  if (el) actionsObserver.observe(el)
})

/** Horizontal shift that keeps the action bar inside the viewer when the box is near the right or left edge. */
const actionsShift = computed(() => {
  const box = selectionBox.value
  if (!box) return 0
  const left = box.left + (actionsBelow.value ? -2 : ACTIONS_MARGIN)
  const maxLeft = (container.value?.clientWidth ?? 0) - ACTIONS_MARGIN - actionsWidth.value
  return Math.max(ACTIONS_MARGIN, Math.min(left, maxLeft)) - left
})

/** Guides are for the page in `url`; hidden while a different page is still opening. */
const guidesReady = ref(false)
/** OpenSeadragon's canvas element: guides go inside it so they stay with the page and under other controls. */
const canvasEl = shallowRef<HTMLElement | null>(null)
const guideBoxes = ref<(ScreenRect & { kind: PageGuide['kind'] })[]>([])

function refreshGuides() {
  const image = item()
  if (!image || !guidesReady.value) {
    guideBoxes.value = []
    return
  }
  guideBoxes.value = (props.guides ?? []).map(({ kind, rect }) => {
    const a = image.imageToViewerElementCoordinates(new OpenSeadragon.Point(rect.x, rect.y))
    const b = image.imageToViewerElementCoordinates(new OpenSeadragon.Point(rect.x + rect.width, rect.y + rect.height))
    return { kind, left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) }
  })
}

watch(() => props.guides, refreshGuides)

/** Bumped whenever the viewport redraws, so screen positions computed from OSD are recomputed. */
const viewportTick = ref(0)
type BoxKind = 'annotation' | 'uneditable'
/** Rect of the annotation being dragged, shown instead of its stored rect until the drag ends. */
const boxDrag = ref<{ kind: BoxKind; id: number; rect: ImageRect } | null>(null)
let stopBoxDrag: (() => void) | null = null

function draggedRect(kind: BoxKind, id: number, rect: ImageRect): ImageRect {
  const drag = boxDrag.value
  return drag?.kind === kind && drag.id === id ? drag.rect : rect
}

/** A page-pixel rect on screen (viewer pixels), at any rotation. */
function screenBox(image: OpenSeadragon.TiledImage, rect: ImageRect) {
  const a = image.imageToViewerElementCoordinates(new OpenSeadragon.Point(rect.x, rect.y))
  const b = image.imageToViewerElementCoordinates(new OpenSeadragon.Point(rect.x + rect.width, rect.y + rect.height))
  return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
}

const annotationBoxes = computed(() => {
  void viewportTick.value
  const image = item()
  if (!viewer || !image || !guidesReady.value) return []
  const screenPxPerImagePx = image.viewportToImageZoom(viewer.viewport.getZoom(true))
  return (props.annotations ?? []).map((annotation) => {
    const box = screenBox(image, draggedRect('annotation', annotation.id, annotation.rect))
    return {
      annotation,
      left: box.left,
      top: box.top,
      width: box.width,
      minHeight: box.height,
      contentWidth: screenPxPerImagePx > 0 ? box.width / screenPxPerImagePx : box.width,
      contentHeight: screenPxPerImagePx > 0 ? box.height / screenPxPerImagePx : box.height,
      pxPerPt: annotation.pxPerPt * screenPxPerImagePx,
    }
  })
})

const uneditableBoxes = computed(() => {
  void viewportTick.value
  const image = item()
  if (!viewer || !image || !guidesReady.value) return []
  const screenPxPerImagePx = image.viewportToImageZoom(viewer.viewport.getZoom(true))
  return (props.uneditableAnnotations ?? []).map((placed) => {
    const box = screenBox(image, draggedRect('uneditable', placed.id, placed.rect))
    return {
      item: placed,
      ...box,
      contentWidth: screenPxPerImagePx > 0 ? box.width / screenPxPerImagePx : box.width,
      contentHeight: screenPxPerImagePx > 0 ? box.height / screenPxPerImagePx : box.height,
      pxPerPt: placed.pxPerPt * screenPxPerImagePx,
      scale: placed.pagePxPerDpi * screenPxPerImagePx,
    }
  })
})

function viewerPoint(event: PointerEvent): { x: number; y: number } {
  const bounds = container.value?.getBoundingClientRect()
  return { x: event.clientX - (bounds?.left ?? 0), y: event.clientY - (bounds?.top ?? 0) }
}

function viewerToImage(x: number, y: number): OpenSeadragon.Point | null {
  return item()?.viewerElementToImageCoordinates(new OpenSeadragon.Point(x, y)) ?? null
}

/** Follows the pointer until release, then reports the final rect (if it changed). */
function dragBox(kind: BoxKind, id: number, event: PointerEvent, rectAt: (x: number, y: number) => ImageRect | null) {
  event.preventDefault()
  stopBoxDrag?.()
  const onMove = (move: PointerEvent) => {
    const p = viewerPoint(move)
    const rect = rectAt(p.x, p.y)
    if (rect) boxDrag.value = { kind, id, rect }
  }
  const onUp = () => {
    const drag = boxDrag.value
    stopBoxDrag?.()
    if (drag?.kind === 'annotation') emit('annotation-change', drag.id, drag.rect)
    else if (drag?.kind === 'uneditable') emit('uneditable-annotation-move', drag.id, drag.rect)
    boxDrag.value = null
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
  stopBoxDrag = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    stopBoxDrag = null
  }
}

function startAnnotationMove(annotation: Annotation, event: PointerEvent) {
  emit('annotation-select', annotation.id)
  startBoxMove('annotation', annotation.id, annotation.rect, event)
}

/** Moves a box with the pointer, kept on the page. */
function startBoxMove(kind: BoxKind, id: number, rect: ImageRect, event: PointerEvent) {
  const start = viewerPoint(event)
  const origin = viewerToImage(start.x, start.y)
  const size = item()?.getContentSize()
  if (!origin || !size) return
  dragBox(kind, id, event, (x, y) => {
    const current = viewerToImage(x, y)
    if (!current) return null
    return {
      ...rect,
      x: Math.round(Math.min(Math.max(rect.x + current.x - origin.x, 0), size.x - rect.width)),
      y: Math.round(Math.min(Math.max(rect.y + current.y - origin.y, 0), size.y - rect.height)),
    }
  })
}

/** The bottom-right handle on screen; converted back through the image so it works at any rotation. */
function startAnnotationResize(box: { annotation: Annotation; left: number; top: number }, event: PointerEvent) {
  const MIN_SIZE = 16
  dragBox('annotation', box.annotation.id, event, (x, y) => {
    const a = viewerToImage(box.left, box.top)
    const b = viewerToImage(Math.max(x, box.left + MIN_SIZE), Math.max(y, box.top + MIN_SIZE))
    if (!a || !b) return null
    const x0 = Math.round(Math.min(a.x, b.x))
    const y0 = Math.round(Math.min(a.y, b.y))
    return { x: x0, y: y0, width: Math.round(Math.max(a.x, b.x)) - x0, height: Math.round(Math.max(a.y, b.y)) - y0 }
  })
}
watch(selection, area.refresh)
watch(
  () => props.selectMode,
  (active) => {
    if (!active) selection.value = null
  },
)

onMounted(() => {
  viewer = OpenSeadragon({
    element: container.value!,
    showNavigationControl: false,
    showNavigator: false,

    // Image always fills `.canvas-container` (like the old viewer scaling to its canvas).
    // OSD's own resize keeps the previous zoom, scaled by how the box's diagonal changed.
    // A shorter page (Legal → Letter in Fit Width) then sits inset inside the border.
    // syncCanvas sizes the viewport itself whenever the box changes.
    autoResize: false,
    visibilityRatio: 1,
    minZoomImageRatio: 1,
    constrainDuringPan: true,
    maxZoomPixelRatio: 4,
    degrees: 0,
    gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: false, dragToPan: true },
  })
  viewer.addHandler('open', () => {
    const image = item()
    if (image) {
      const size = image.getContentSize()
      pagePixels.value = { width: size.x, height: size.y }
    }
    setRotation(props.rotation, true)
    const turnedByWheel = performance.now() - lastPageScroll < WHEEL_TURN_OPEN_MS
    void syncCanvas(true).then(() => {
      applyEnterEdge(turnedByWheel ? enterEdge : 'top')
      enterEdge = 'top'
      guidesReady.value = true
      refreshGuides()
    })
  })
  viewer.addHandler('open-failed', (event) => {
    emit('open-failed', (event as unknown as { message?: string }).message ?? 'Failed to open image.')
  })
  viewer.addHandler('canvas-scroll', onCanvasScroll)
  area.attach(viewer)
  eraseArea.attach(viewer)
  attachReposition(viewer)
  canvasEl.value = viewer.canvas
  viewer.addHandler('update-viewport', refreshGuides)
  viewer.addHandler('resize', refreshGuides)
  viewer.addHandler('update-viewport', () => viewportTick.value++)
  viewer.addHandler('resize', () => viewportTick.value++)
  viewer.addHandler('canvas-press', () => {
    if (props.activeAnnotation != null) emit('annotation-select', null)
  })
  wrapObserver = new ResizeObserver((entries) => {
    const entry = entries[0]
    if (!entry) return
    const { width, height } = entry.contentRect
    const scrolled = wrapScrollFraction()
    wrapSize.value = { width, height }
    queueMicrotask(() => {
      void syncCanvas(true).then(() => restoreWrapScroll(scrolled))
    })
  })
  if (wrapEl.value) wrapObserver.observe(wrapEl.value)
  if (props.url) open(props.url)
})

onBeforeUnmount(() => {
  stopBoxDrag?.()
  window.clearTimeout(repositionTimer)
  actionsObserver.disconnect()
  wrapObserver?.disconnect()
  wrapObserver = null
  viewer?.destroy()
  viewer = null
})

/**
 * One watch for url / rotation / canvas size / fit mode. Rotation must update OSD *before*
 * syncCanvas — separate canvasSize + rotation watches raced (size sync ran with the old angle),
 * so Rotate left → Rotate right (or Cancel) could leave Fit Width looking wrong.
 */
watch(
  () => ({
    url: props.url,
    rotation: props.rotation,
    pageKey: props.pageKey,
    sizeW: canvasSize.value?.width ?? 0,
    sizeH: canvasSize.value?.height ?? 0,
    fitMode: props.fitMode,
  }),
  (curr, prev) => {
    if (!prev) return
    if (curr.url !== prev.url) {
      if (curr.url && curr.pageKey === prev.pageKey && hasImage()) {
        replaceImage(curr.url)
        return
      }
      selection.value = null
      if (curr.url) open(curr.url)
      else viewer?.close()
      return
    }
    if (curr.rotation !== prev.rotation) {
      rotateTo(curr.rotation)
      return
    }
    if (curr.sizeW !== prev.sizeW || curr.sizeH !== prev.sizeH || curr.fitMode !== prev.fitMode) {
      if (curr.fitMode) void syncCanvas(true)
      else if (curr.sizeW > 0) void syncCanvas(true)
    }
  },
)

function open(url: string) {
  endRepositionPreview()
  guidesReady.value = false
  refreshGuides()
  viewer?.open({ type: 'image', url, buildPyramid: true })
}

/** Adds the new rendering on top and removes the old one once drawn, so the view doesn't flash or move. */
function replaceImage(url: string) {
  if (!viewer) return
  const previous = item()
  viewer.addTiledImage({
    tileSource: { type: 'image', url, buildPyramid: true },
    success: (event) => {
      const added = (event as unknown as { item: OpenSeadragon.TiledImage }).item
      const removePrevious = () => {
        if (viewer && previous) viewer.world.removeItem(previous)
        if (repositionDrag.value?.released) endRepositionPreview()
      }
      if (added.getFullyLoaded()) removePrevious()
      else added.addOnceHandler('fully-loaded-change', removePrevious)
    },
    error: (err) => emit('open-failed', err?.message ?? 'Failed to update image.'),
  })
}

/**
 * The displayed image. During a replaceImage swap there are briefly two (same size);
 * the newest is on top.
 */
function item(): OpenSeadragon.TiledImage | null {
  const count = viewer?.world.getItemCount() ?? 0
  return count > 0 ? viewer!.world.getItemAt(count - 1) : null
}

function hasImage(): boolean {
  return item() !== null
}

function setRotation(degrees: number, immediately = false) {
  ;(viewer?.viewport as unknown as RotatableViewport | undefined)?.setRotation(degrees, immediately)
}

/**
 * Turns to `degrees` the short way round, then re-fits. With a sticky fit mode the turn snaps
 * immediately so syncCanvas never measures mid-rotation.
 */
function rotateTo(degrees: number) {
  if (!viewer || !hasImage()) return
  const current = viewer.viewport.getRotation()
  const delta = ((((degrees - current) % 360) + 540) % 360) - 180
  const snap = !!props.fitMode
  if (Math.abs(delta) >= 1e-6) setRotation(current + delta, snap)
  if (props.fitMode) fit(props.fitMode)
  else void syncCanvas(true)
}

/**
 * Sizes `.canvas-container` for the fit mode and scales the page image into it (like drawing into the
 * old viewer's canvas). `edge` is where a taller canvas starts in the scrollable stage.
 */
function fit(mode: FitMode, _immediately = false, edge: Edge = 'top') {
  if (mode === 'actual') manualScale.value = 1
  void syncCanvas(true).then(() => {
    applyEnterEdge(edge)
    // Portrait ↔ landscape toggles the scrollbar and wrap width; re-fit once layout settles.
    requestAnimationFrame(() => {
      void syncCanvas(true)
    })
  })
}

/** How far the stage is scrolled down (0–1), or null when the canvas fits. */
function wrapScrollFraction(): number | null {
  const wrap = wrapEl.value
  if (!wrap || wrap.scrollHeight <= wrap.clientHeight + 1) return null
  return Math.min(Math.max(wrap.scrollTop / (wrap.scrollHeight - wrap.clientHeight), 0), 1)
}

function restoreWrapScroll(scrolled: number | null) {
  const wrap = wrapEl.value
  if (scrolled === null || !wrap || wrap.scrollHeight <= wrap.clientHeight + 1) return
  wrap.scrollTop = scrolled * (wrap.scrollHeight - wrap.clientHeight)
}

function applyEnterEdge(edge: Edge) {
  const wrap = wrapEl.value
  if (!wrap) return
  wrap.scrollTop = edge === 'top' ? 0 : Math.max(0, wrap.scrollHeight - wrap.clientHeight)
  wrap.scrollLeft = 0
}

defineExpose({
  zoomIn: () => scaleCanvas(1.25),
  zoomOut: () => scaleCanvas(1 / 1.25),
  fit: (mode: FitMode) => fit(mode),
  setZoomPercent: (percent: number) => {
    if (!Number.isFinite(percent) || percent <= 0) return
    manualScale.value = percent / 100
    void syncCanvas(true)
  },
  /** Page pixel at the center of the view, or null when nothing is shown. */
  viewCenter: (): { x: number; y: number } | null => {
    const image = item()
    if (!viewer || !image) return null
    const center = image.viewportToImageCoordinates(viewer.viewport.getCenter(true))
    return { x: center.x, y: center.y }
  },
})
</script>

<template>
  <div
    ref="wrapEl"
    class="osd-wrap"
    :class="{
      selecting: selectMode || eraseMode,
      repositioning: repositionMode,
      'fit-width': fitMode === 'width',
      'fit-page': fitMode === 'page',
    }"
  >
    <!--
      Like the old viewer's canvas-container: explicit CSS size of the displayed page; the image is
      scaled to fill it. Black border around the page; the stage (this wrap) scrolls when the page is taller.
    -->
    <div class="canvas-container" :style="canvasContainerStyle">
      <div ref="container" class="osd-viewer" :style="{ '--image-filter': imageFilter }" />
    </div>
    <Teleport v-if="canvasEl" :to="canvasEl">
      <div v-if="repositionPreview" class="reposition-preview" :style="repositionPreview.page" aria-hidden="true">
        <img :src="url!" alt="" draggable="false" :style="repositionPreview.image" />
      </div>
      <div v-if="guideBoxes.length" class="guides" aria-hidden="true">
        <div
          v-for="(box, i) in guideBoxes"
          :key="i"
          class="guide"
          :class="box.kind"
          :style="{
            left: `${box.left}px`,
            top: `${box.top}px`,
            width: `${box.right - box.left}px`,
            height: `${box.bottom - box.top}px`,
          }"
        />
      </div>
      <div v-if="annotationBoxes.length" class="annotations" :class="{ locked: annotationsLocked }">
        <AnnotationBox
          v-for="box in annotationBoxes"
          :key="box.annotation.id"
          :left="box.left"
          :top="box.top"
          :width="box.width"
          :min-height="box.minHeight"
          :text="box.annotation.text"
          :px-per-pt="box.pxPerPt"
          :html="box.annotation.html"
          :content-width="box.contentWidth"
          :content-height="box.contentHeight"
          :active="box.annotation.id === activeAnnotation"
          :border="box.annotation.border"
          :background="box.annotation.placeBackground"
          @press-move="startAnnotationMove(box.annotation, $event)"
          @press-resize="startAnnotationResize(box, $event)"
          @edit="emit('annotation-edit', box.annotation.id)"
          @remove="emit('annotation-remove', box.annotation.id)"
        />
      </div>
      <div v-if="uneditableBoxes.length" class="annotations">
        <UneditableAnnotationBox
          v-for="box in uneditableBoxes"
          :key="box.item.id"
          :left="box.left"
          :top="box.top"
          :width="box.width"
          :height="box.height"
          :content-width="box.contentWidth"
          :content-height="box.contentHeight"
          :annotation="box.item.annotation"
          :image-run="box.item.imageRun"
          :px-per-pt="box.pxPerPt"
          :scale="box.scale"
          :applied="box.item.applied"
          @press-move="startBoxMove('uneditable', box.item.id, box.item.rect, $event)"
        />
      </div>
    </Teleport>
    <div
      v-if="eraseMode && eraseBox && eraseRect"
      class="erase-box"
      :style="{
        left: `${eraseBox.left}px`,
        top: `${eraseBox.top}px`,
        width: `${eraseBox.right - eraseBox.left}px`,
        height: `${eraseBox.bottom - eraseBox.top}px`,
      }"
    />
    <div
      v-if="selectMode && selectionBox && selection"
      class="selection"
      :class="{ previewing: !!selectionFilter }"
      :style="{
        left: `${selectionBox.left}px`,
        top: `${selectionBox.top}px`,
        width: `${selectionBox.right - selectionBox.left}px`,
        height: `${selectionBox.bottom - selectionBox.top}px`,
        backdropFilter: selectionFilter ?? undefined,
      }"
      @pointerdown="area.startMove"
    >
      <span class="selection-size">{{ selection.width }} × {{ selection.height }} px</span>
      <span
        v-for="handle in HANDLES"
        :key="handle"
        class="handle"
        :class="handle"
        @pointerdown.stop="area.startResize(handle, $event)"
      />
      <div
        v-if="$slots['selection-actions']"
        ref="actionsEl"
        class="selection-actions"
        :class="{ inside: !actionsBelow }"
        :style="{ translate: `${actionsShift}px 0` }"
        @pointerdown.stop
        @wheel.stop
      >
        <slot name="selection-actions" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.osd-wrap {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  width: 100%;
  height: 100%;
  overflow: auto;
  background: #5a5a5a;
}

/*
 * Fit Width: only vertical scrolling. The gutter is always reserved, so a scrollbar appearing
 * (a page just a few pixels too tall) does not shrink the content width, reflow the page shorter,
 * drop the scrollbar, and repeat — that loop flickered the image.
 */
.osd-wrap.fit-width {
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

/* Best Fit: page is sized to the stage — scrollbars mean a rounding / layout bug. */
.osd-wrap.fit-page {
  overflow: hidden;
}

/* Page-sized box (old viewer: canvas-container); image fills it via OpenSeadragon fitBounds. */
.canvas-container {
  position: relative;
  flex-shrink: 0;
  box-sizing: content-box;
  margin: 0;
  border: 1px solid #000;
  background: #fff;
  overflow: hidden;
}

.osd-viewer {
  width: 100%;
  height: 100%;
  background: #fff;
}

.osd-viewer :deep(canvas) {
  filter: var(--image-filter, none);
}

.guides {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.guide {
  position: absolute;
}

.annotations {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.annotations.locked > * {
  pointer-events: none;
}

.guide.margin {
  background: rgb(150 150 150 / 30%);
}

.guide.keep-clear {
  background: rgb(150 150 150 / 22%);
  outline: 1px dashed rgb(110 110 110 / 85%);
  outline-offset: -1px;
}
.selecting .osd-viewer :deep(.openseadragon-canvas) {
  cursor: crosshair !important;
}

.repositioning .osd-viewer :deep(.openseadragon-canvas) {
  cursor: move !important;
}

/* The page with its content moved; covers the page in the canvas while dragging. */
.reposition-preview {
  position: absolute;
  overflow: hidden;
  background: #fff;
  outline: 1px dashed #2f6fd1;
  pointer-events: none;
}

.reposition-preview img {
  position: absolute;
  left: 50%;
  top: 50%;
  filter: var(--image-filter, none);
}

.selection {
  position: absolute;
  border: 2px dashed #2f6fd1;
  background: rgb(47 111 209 / 15%);
  box-shadow: 0 0 0 1px rgb(255 255 255 / 60%);
  cursor: move;
  touch-action: none;
}

.erase-box {
  position: absolute;
  border: 2px dashed #c0392b;
  background: rgb(255 255 255 / 70%);
  box-shadow: 0 0 0 1px rgb(255 255 255 / 60%);
  pointer-events: none;
}

.selection.previewing {
  background: none;
}

.selection-actions {
  position: absolute;
  top: calc(100% + 8px);
  left: -2px;
  z-index: 2;
  cursor: default;
}

.selection-actions.inside {
  top: auto;
  bottom: 8px;
  left: 8px;
}

.selection-size {
  position: absolute;
  bottom: calc(100% + 4px);
  left: -2px;
  padding: 1px 6px;
  border-radius: 3px;
  background: #2f6fd1;
  color: #fff;
  font-size: 12px;
  white-space: nowrap;
  pointer-events: none;
}

.handle {
  position: absolute;
  width: 10px;
  height: 10px;
  border: 1px solid #2f6fd1;
  background: #fff;
  touch-action: none;
}

.handle.n,
.handle.s {
  left: calc(50% - 5px);
  cursor: ns-resize;
}

.handle.e,
.handle.w {
  top: calc(50% - 5px);
  cursor: ew-resize;
}

.handle.n,
.handle.ne,
.handle.nw {
  top: -6px;
}

.handle.s,
.handle.se,
.handle.sw {
  bottom: -6px;
}

.handle.w,
.handle.nw,
.handle.sw {
  left: -6px;
}

.handle.e,
.handle.ne,
.handle.se {
  right: -6px;
}

.handle.ne,
.handle.sw {
  cursor: nesw-resize;
}

.handle.nw,
.handle.se {
  cursor: nwse-resize;
}

</style>
