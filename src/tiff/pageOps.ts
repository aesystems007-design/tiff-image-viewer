import type { RichText } from '../annotations/richText'
import type { ImageRect } from '../viewer/imageRect'
import type { PageInfo } from './protocol'

/**
 * An edit on one page, applied in order. Rects are in page pixels (unrotated page) of the page
 * as it is at that point in the list, i.e. after any earlier `paper` op changed its size.
 */
export type PageOp = PixelOp | PaperOp | TextOp | ScaleOp | DeskewOp | ShiftOp

/**
 * Moves the page content by `dx`, `dy` page pixels (unrotated page); the page size stays, content moved off the
 * page is cropped and the uncovered area is white.
 */
export interface ShiftOp {
  type: 'shift'
  dx: number
  dy: number
}

/**
 * `ops` with the content moved `dx`, `dy` further. Consecutive moves share one shift op, so content moved off
 * the page and back again isn't lost; moving back to where it started removes the op.
 */
export function withShift(ops: readonly PageOp[], dx: number, dy: number): PageOp[] {
  const last = ops[ops.length - 1]
  const kept = last?.type === 'shift' ? ops.slice(0, -1) : [...ops]
  const x = Math.round((last?.type === 'shift' ? last.dx : 0) + dx)
  const y = Math.round((last?.type === 'shift' ? last.dy : 0) + dy)
  return x === 0 && y === 0 ? kept : [...kept, { type: 'shift', dx: x, dy: y }]
}

/**
 * Straightens skewed content: rotates it by `angle` degrees counter-clockwise around the page center
 * (`angle` is the measured skew, clockwise positive); the page size stays, uncovered corners are white.
 */
export interface DeskewOp {
  type: 'deskew'
  angle: number
}

/** Scales the page content around the page center by `factor`; the page size stays (cropped / padded white). */
export interface ScaleOp {
  type: 'scale'
  factor: number
}

/** Change in scale per click of the increase / decrease page size buttons (of the original size). */
export const SCALE_STEP = 0.05

/**
 * `ops` with the content scaled by one more `step` (e.g. +0.05 = 5% bigger). Consecutive steps share one
 * scale op, so the page is resampled once and up/down steps cancel out exactly.
 */
export function withScaleStep(ops: readonly PageOp[], step: number): PageOp[] {
  const last = ops[ops.length - 1]
  const previous = last?.type === 'scale' ? last.factor : 1
  const factor = Math.max(SCALE_STEP, Math.round((previous + step) * 100) / 100)
  const kept = last?.type === 'scale' ? ops.slice(0, -1) : [...ops]
  return factor === 1 ? kept : [...kept, { type: 'scale', factor }]
}

/**
 * Draws rich text (an applied annotation). `rect`'s top-left on screen is where the text starts; the text is
 * drawn upright for a page shown at `rotation` and wrapped to the box's on-screen width.
 */
export interface TextOp {
  type: 'text'
  rect: ImageRect
  rotation: number
  /** Page pixels per point (page DPI / 72). */
  pxPerPt: number
  text: RichText
  /** Frame around the box (grown to fit the text, like the overlay). */
  border?: boolean
  /** Box fill behind the text (the annotation's burn background). Omitted leaves the page underneath. */
  fill?: string
  /** 0–1. Covers the fill, the text and the stroke. */
  opacity?: number
  /** Where the text sits in the box. Omitted means the top. */
  valign?: 'top' | 'middle' | 'bottom'
  /** Outline of the box, in page pixels. */
  stroke?: { color: string; width: number; dash: 'solid' | 'dashed' | 'dotted' }
  /**
   * PNG data URL of HTML rasterized at the box size, drawn behind the text and filling the box.
   * Inline pictures are part of `text` and are drawn in the line. Omitted when there is no HTML.
   */
  picture?: string
}

/** Resizes the page to `width` x `height` px: content scaled to fit (aspect kept), centered on white. */
export interface PaperOp {
  type: 'paper'
  width: number
  height: number
}

/** An edit that keeps the page size. */
export type PixelOp =
  | { type: 'erase'; rect: ImageRect }
  /** `amount` uses the CSS contrast() scale: 1 = unchanged, 2 = double, 0.5 = half. */
  | { type: 'contrast'; rect: ImageRect; amount: number }
  /** `amount` uses the CSS brightness() scale: 1 = unchanged, 0 = black, 2 = twice as bright. */
  | { type: 'brightness'; rect: ImageRect; amount: number }
  /** Removes dark specks of at most `maxSize` connected pixels. */
  | { type: 'despeckle'; rect: ImageRect; maxSize: number }

/**
 * Largest speck (pixels) removed by each click of the despeckle page buttons, light to aggressive:
 * blobs up to 1×1, 2×2, 3×3 ... 10×10 px. A printed period is about 3×3 at 200 dpi, 5×5 at 300 dpi.
 */
export const DESPECKLE_LEVELS = [1, 2, 3, 4, 5, 6, 8, 10].map((side) => side * side)

function isWholePage(rect: ImageRect, page: { width: number; height: number }): boolean {
  return rect.x === 0 && rect.y === 0 && rect.width === page.width && rect.height === page.height
}

/**
 * `ops` with whole-page despeckle one level stronger (1-based `level`), or null when it's already at the
 * strongest. Consecutive clicks update the trailing despeckle op, so the page is despeckled once.
 */
export function withDespeckleStep(
  ops: readonly PageOp[],
  page: { width: number; height: number },
): { ops: PageOp[]; level: number } | null {
  let last: PageOp | undefined
  for (const op of ops) if (op.type === 'despeckle' && isWholePage(op.rect, page)) last = op
  const lastSize = last?.type === 'despeckle' ? last.maxSize : 0
  const current = DESPECKLE_LEVELS.filter((size) => size <= lastSize).length
  if (current >= DESPECKLE_LEVELS.length) return null
  const op: PageOp = {
    type: 'despeckle',
    rect: { x: 0, y: 0, width: page.width, height: page.height },
    maxSize: DESPECKLE_LEVELS[current],
  }
  const kept = last && last === ops[ops.length - 1] ? ops.slice(0, -1) : [...ops]
  return { ops: [...kept, op], level: current + 1 }
}

/** Default largest speck (in pixels) removed by area despeckle: a 3x3 dot is 9, a printed period at 300 dpi is ~25. */
export const DEFAULT_SPECK_SIZE = 12

export type PaperSize = 'letter' | 'legal'

/** Portrait paper sizes in inches. */
export const PAPER_SIZES: Record<PaperSize, { width: number; height: number }> = {
  letter: { width: 8.5, height: 11 },
  legal: { width: 8.5, height: 14 },
}

/** Assumed page width when a TIFF has no resolution tags (US Letter). */
const FALLBACK_PAGE_WIDTH_INCHES = 8.5

/** Dots per inch of a page, from its TIFF tags or (without them) assuming it is 8.5" wide. */
export function pageResolution(page: PageInfo): { dpiX: number; dpiY: number } {
  const fallback = page.width / FALLBACK_PAGE_WIDTH_INCHES
  return { dpiX: page.dpiX ?? page.dpiY ?? fallback, dpiY: page.dpiY ?? page.dpiX ?? fallback }
}

/** The page after its edits: `paper` ops change the size; resolution stays the same. */
export function editedPageInfo(page: PageInfo, ops: readonly PageOp[]): PageInfo {
  let { width, height } = page
  for (const op of ops) {
    if (op.type === 'paper') ({ width, height } = op)
  }
  return width === page.width && height === page.height ? page : { ...page, width, height }
}

/**
 * The op converting `page` (as currently edited) to `size`, always portrait (Letter is 8.5" × 11",
 * Legal is 8.5" × 14"), or null if it already has that size. A sideways scan is fitted into that page.
 */
export function paperOp(page: PageInfo, size: PaperSize): PaperOp | null {
  const { dpiX, dpiY } = pageResolution(page)
  const paper = PAPER_SIZES[size]
  const width = Math.round(paper.width * dpiX)
  const height = Math.round(paper.height * dpiY)
  return width === page.width && height === page.height ? null : { type: 'paper', width, height }
}

export interface Pixels {
  /** RGBA, row-major. */
  data: Uint8ClampedArray
  width: number
  height: number
}

/** Stable cache key for a list of edits. */
export function opsKey(ops: readonly PageOp[]): string {
  return ops.length === 0 ? '' : JSON.stringify(ops)
}

/** Applies pixel edits in order, in place. */
export function applyOps(pixels: Pixels, ops: readonly PixelOp[]): void {
  for (const op of ops) {
    const rect = clampRect(op.rect, pixels)
    if (!rect) continue
    switch (op.type) {
      case 'erase':
        erase(pixels, rect)
        break
      case 'contrast':
        mapChannels(pixels, rect, (v) => ((v / 255 - 0.5) * op.amount + 0.5) * 255)
        break
      case 'brightness':
        mapChannels(pixels, rect, (v) => v * op.amount)
        break
      case 'despeckle':
        despeckle(pixels, rect, op.maxSize)
        break
    }
  }
}

function clampRect(rect: ImageRect, pixels: Pixels): ImageRect | null {
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(pixels.width, Math.ceil(rect.x + rect.width))
  const y1 = Math.min(pixels.height, Math.ceil(rect.y + rect.height))
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null
}

function erase({ data, width }: Pixels, rect: ImageRect) {
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    data.fill(255, (y * width + rect.x) * 4, (y * width + rect.x + rect.width) * 4)
  }
}

/** Maps the R, G and B channels through `fn` (same per-channel formulas as the CSS filter functions). */
function mapChannels({ data, width }: Pixels, rect: ImageRect, fn: (value: number) => number) {
  const table = new Uint8ClampedArray(256)
  for (let v = 0; v < 256; v++) table[v] = fn(v)
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let i = (y * width + rect.x) * 4, end = i + rect.width * 4; i < end; i += 4) {
      data[i] = table[data[i]]
      data[i + 1] = table[data[i + 1]]
      data[i + 2] = table[data[i + 2]]
    }
  }
}

/**
 * Finds 8-connected groups of dark pixels inside the rect and turns groups of at most
 * `maxSize` pixels white. Pixels outside the rect are treated as background.
 */
function despeckle({ data, width }: Pixels, rect: ImageRect, maxSize: number) {
  const w = rect.width
  const h = rect.height
  const isInk = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((rect.y + y) * width + rect.x + x) * 4
      isInk[y * w + x] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 128 ? 1 : 0
    }
  }

  const visited = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  const component = new Int32Array(w * h)

  for (let start = 0; start < w * h; start++) {
    if (!isInk[start] || visited[start]) continue
    let stackSize = 0
    let size = 0
    stack[stackSize++] = start
    visited[start] = 1
    while (stackSize > 0) {
      const p = stack[--stackSize]
      component[size++] = p
      const px = p % w
      const py = (p - px) / w
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx
          if (nx < 0 || nx >= w) continue
          const n = ny * w + nx
          if (isInk[n] && !visited[n]) {
            visited[n] = 1
            stack[stackSize++] = n
          }
        }
      }
    }
    if (size > maxSize) continue
    for (let k = 0; k < size; k++) {
      const p = component[k]
      const i = ((rect.y + Math.floor(p / w)) * width + rect.x + (p % w)) * 4
      data[i] = data[i + 1] = data[i + 2] = 255
    }
  }
}
