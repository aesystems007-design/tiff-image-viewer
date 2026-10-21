import OpenSeadragon from 'openseadragon'
import { onBeforeUnmount, ref, type Ref } from 'vue'
import type { ImageRect } from './imageRect'

/** Selection box position in viewer-element pixels (what's drawn on screen). */
export interface ScreenRect {
  left: number
  top: number
  right: number
  bottom: number
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export const HANDLES: Handle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

/** Drags shorter than this (screen px) count as a click, which clears the selection. */
const MIN_DRAG_PX = 4

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * Rubber-band area selection on top of an OpenSeadragon viewer.
 * The selection is stored in page pixels, so it survives zoom, pan and 90° rotations;
 * the on-screen box is recomputed every time the viewport redraws.
 */
export function useAreaSelection(options: {
  getViewer: () => OpenSeadragon.Viewer | null
  /** Element sharing the viewer canvas's coordinate space. */
  container: Ref<HTMLElement | undefined>
  isActive: () => boolean
  selection: Ref<ImageRect | null>
  /** Called when a drag that drew a new rectangle ends. */
  onDrawEnd?: (rect: ImageRect) => void
}) {
  const { getViewer, container, isActive, selection, onDrawEnd } = options
  const screenRect = ref<ScreenRect | null>(null)

  let drawStart: { image: OpenSeadragon.Point; screen: OpenSeadragon.Point } | null = null
  let dragged = false
  let stopPointerTracking: (() => void) | null = null

  /** The displayed image (topmost; while an edited version is being swapped in there are briefly two of the same size). */
  function image(): OpenSeadragon.TiledImage | null {
    const viewer = getViewer()
    const count = viewer?.world.getItemCount() ?? 0
    return count > 0 ? viewer!.world.getItemAt(count - 1) : null
  }

  function imageSize(): { width: number; height: number } {
    const size = image()?.getContentSize()
    return { width: size?.x ?? 0, height: size?.y ?? 0 }
  }

  function toImage(x: number, y: number): OpenSeadragon.Point | null {
    return image()?.viewerElementToImageCoordinates(new OpenSeadragon.Point(x, y)) ?? null
  }

  function toScreen(x: number, y: number): OpenSeadragon.Point | null {
    return image()?.imageToViewerElementCoordinates(new OpenSeadragon.Point(x, y)) ?? null
  }

  /** Axis-aligned rectangle between two page points, clamped to the page and rounded to whole pixels. */
  function rectBetween(a: OpenSeadragon.Point, b: OpenSeadragon.Point): ImageRect | null {
    const { width, height } = imageSize()
    const x0 = Math.round(clamp(Math.min(a.x, b.x), 0, width))
    const y0 = Math.round(clamp(Math.min(a.y, b.y), 0, height))
    const x1 = Math.round(clamp(Math.max(a.x, b.x), 0, width))
    const y1 = Math.round(clamp(Math.max(a.y, b.y), 0, height))
    if (x1 - x0 < 1 || y1 - y0 < 1) return null
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
  }

  function refresh() {
    const rect = selection.value
    const a = rect && toScreen(rect.x, rect.y)
    const b = rect && toScreen(rect.x + rect.width, rect.y + rect.height)
    screenRect.value =
      a && b
        ? { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) }
        : null
  }

  function localPoint(event: PointerEvent): { x: number; y: number } {
    const bounds = container.value?.getBoundingClientRect()
    return { x: event.clientX - (bounds?.left ?? 0), y: event.clientY - (bounds?.top ?? 0) }
  }

  function trackPointer(onMove: (event: PointerEvent) => void) {
    stopPointerTracking?.()
    const onUp = () => stopPointerTracking?.()
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    stopPointerTracking = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      stopPointerTracking = null
    }
  }

  /** Wire into the viewer's canvas events so drags draw a new selection instead of panning. */
  function attach(viewer: OpenSeadragon.Viewer) {
    viewer.addHandler('canvas-press', (event) => {
      if (!isActive()) return
      const image = toImage(event.position.x, event.position.y)
      drawStart = image ? { image, screen: event.position } : null
      dragged = false
    })
    viewer.addHandler('canvas-drag', (event) => {
      if (!isActive()) return
      event.preventDefaultAction = true
      if (!drawStart) return
      if (!dragged && event.position.distanceTo(drawStart.screen) < MIN_DRAG_PX) return
      dragged = true
      const current = toImage(event.position.x, event.position.y)
      if (current) selection.value = rectBetween(drawStart.image, current)
    })
    viewer.addHandler('canvas-drag-end', (event) => {
      if (isActive()) event.preventDefaultAction = true
    })
    viewer.addHandler('canvas-release', () => {
      if (drawStart && !dragged) selection.value = null
      else if (drawStart && selection.value) onDrawEnd?.(selection.value)
      drawStart = null
    })
    viewer.addHandler('update-viewport', refresh)
    viewer.addHandler('resize', refresh)
  }

  function startMove(event: PointerEvent) {
    const start = selection.value
    const local = localPoint(event)
    const origin = toImage(local.x, local.y)
    if (!start || !origin) return
    event.preventDefault()
    trackPointer((move) => {
      const p = localPoint(move)
      const current = toImage(p.x, p.y)
      if (!current) return
      const { width, height } = imageSize()
      selection.value = {
        ...start,
        x: Math.round(clamp(start.x + current.x - origin.x, 0, width - start.width)),
        y: Math.round(clamp(start.y + current.y - origin.y, 0, height - start.height)),
      }
    })
  }

  // Resizing works on screen edges, then converts back, so handles behave the same at any rotation.
  function startResize(handle: Handle, event: PointerEvent) {
    const start = screenRect.value
    if (!start) return
    event.preventDefault()
    trackPointer((move) => {
      const p = localPoint(move)
      const edges = { ...start }
      if (handle.includes('n')) edges.top = p.y
      if (handle.includes('s')) edges.bottom = p.y
      if (handle.includes('w')) edges.left = p.x
      if (handle.includes('e')) edges.right = p.x
      const a = toImage(edges.left, edges.top)
      const b = toImage(edges.right, edges.bottom)
      const next = a && b && rectBetween(a, b)
      if (next) selection.value = next
    })
  }

  onBeforeUnmount(() => stopPointerTracking?.())

  return { screenRect, attach, refresh, startMove, startResize }
}
