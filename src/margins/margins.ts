import { pageResolution } from '../tiff/pageOps'
import type { PageInfo } from '../tiff/protocol'
import { unrotateRect } from '../viewer/imageRect'
import type { PageGuide } from '../viewer/pageGuide'

/** Margin rules for a document, as returned by the margins API. All lengths are in inches. */
export interface MarginSpec {
  firstPage: PageMarginSpec
  lastPage: PageMarginSpec
  /** Every page that isn't the first or last. */
  defaultPage: PageMarginSpec
}

/**
 * Maps GetDocumentImage's `documentMargins` (nullable page rules + `*MarginsAreZero` flags) to a
 * `MarginSpec`, or null when there is nothing to draw. The host passes this on `open-image` or
 * `set-margins`. The viewer must not fetch margins itself when hosted.
 */
export function marginSpecFromHost(value: unknown): MarginSpec | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const zero = { top: 0, bottom: 0, left: 0, right: 0, otherAreas: null as OtherArea[] | null }
  const defaultPage = pageMarginFromHost(raw.defaultPage, !!raw.defaultPageMarginsAreZero, zero)
  const firstPage = pageMarginFromHost(raw.firstPage, !!raw.firstPageMarginsAreZero, defaultPage)
  const lastPage = pageMarginFromHost(raw.lastPage, !!raw.lastPageMarginsAreZero, defaultPage)
  if (isBlankPage(firstPage) && isBlankPage(lastPage) && isBlankPage(defaultPage)) return null
  return { firstPage, lastPage, defaultPage }
}

function pageMarginFromHost(value: unknown, areZero: boolean, fallback: PageMarginSpec): PageMarginSpec {
  if (areZero) return { top: 0, bottom: 0, left: 0, right: 0, otherAreas: null }
  if (!value || typeof value !== 'object') return fallback
  const page = value as Record<string, unknown>
  const top = Number(page.top)
  const bottom = Number(page.bottom)
  const left = Number(page.left)
  const right = Number(page.right)
  if (![top, bottom, left, right].every(Number.isFinite)) return fallback
  const otherAreas = Array.isArray(page.otherAreas)
    ? page.otherAreas.map(otherAreaFromHost).filter((area): area is OtherArea => area !== null)
    : null
  return { top, bottom, left, right, otherAreas: otherAreas && otherAreas.length ? otherAreas : null }
}

function otherAreaFromHost(value: unknown): OtherArea | null {
  if (!value || typeof value !== 'object') return null
  const area = value as Record<string, unknown>
  const boundsRaw = area.bounds
  if (!boundsRaw || typeof boundsRaw !== 'object') return null
  const b = boundsRaw as Record<string, unknown>
  const x = Number(b.x)
  const y = Number(b.y)
  const width = Number(b.width)
  const height = Number(b.height)
  const anchor = Number(area.anchor)
  if (![x, y, width, height, anchor].every(Number.isFinite)) return null
  return { bounds: { x, y, width, height }, anchor }
}

function isBlankPage(page: PageMarginSpec): boolean {
  return page.top === 0 && page.bottom === 0 && page.left === 0 && page.right === 0 && !page.otherAreas?.length
}

export interface PageMarginSpec {
  top: number
  bottom: number
  left: number
  right: number
  /** Other areas that should be clear of text (e.g. a recording stamp box). */
  otherAreas: OtherArea[] | null
}

export interface OtherArea {
  /** .NET RectangleF-style bounds; only x, y, width and height are used. */
  bounds: { x: number; y: number; width: number; height: number }
  /** Flags for the page edges `bounds` is measured from (see ANCHOR_*). */
  anchor: number
}

// 5 = top + right: `x` is the distance from the right edge in to the box, so { x: 3, y: 0, width: 3, height: 3 }
// fills the 3" x 3" upper right corner. Without the right flag x is from the left edge; without bottom, y is from the top.
const ANCHOR_BOTTOM = 2
const ANCHOR_RIGHT = 4
/** Picks the rules for the page at `position` (0-based, in display order) of a `count`-page document. */
export function pageMarginSpec(spec: MarginSpec, position: number, count: number): PageMarginSpec {
  if (position === 0) return spec.firstPage
  if (position === count - 1) return spec.lastPage
  return spec.defaultPage
}

/**
 * Converts the rules for one page into rectangles in page pixels (unrotated page, like every other
 * page-pixel rect). Margins apply to the page as displayed: when the page is rotated the margins stay
 * where they are on screen (top stays top, the upper right box stays upper right), only the content turns.
 */
export function marginGuides(rules: PageMarginSpec, page: PageInfo, rotation = 0): PageGuide[] {
  if (page.width <= 0 || page.height <= 0) return []
  const sideways = rotation % 180 !== 0
  const { dpiX: pageDpiX, dpiY: pageDpiY } = pageResolution(page)
  const displayed = {
    width: sideways ? page.height : page.width,
    height: sideways ? page.width : page.height,
    dpiX: sideways ? pageDpiY : pageDpiX,
    dpiY: sideways ? pageDpiX : pageDpiY,
  }
  return displayedGuides(rules, displayed).map((guide) => ({
    ...guide,
    rect: unrotateRect(guide.rect, rotation, page.width, page.height),
  }))
}

/** Guides in the coordinates of the page as displayed (after rotation). */
function displayedGuides(
  rules: PageMarginSpec,
  { width, height, dpiX, dpiY }: { width: number; height: number; dpiX: number; dpiY: number },
): PageGuide[] {
  const top = clamp(Math.round(rules.top * dpiY), 0, height)
  const bottom = clamp(Math.round(rules.bottom * dpiY), 0, height - top)
  const left = clamp(Math.round(rules.left * dpiX), 0, width)
  const right = clamp(Math.round(rules.right * dpiX), 0, width - left)
  const middle = height - top - bottom

  // Top and bottom bands span the full width; the side bands fill in between, so nothing is shaded twice.
  const guides: PageGuide[] = [
    { kind: 'margin', edge: 'top', rect: { x: 0, y: 0, width, height: top } },
    { kind: 'margin', edge: 'bottom', rect: { x: 0, y: height - bottom, width, height: bottom } },
    { kind: 'margin', edge: 'left', rect: { x: 0, y: top, width: left, height: middle } },
    { kind: 'margin', edge: 'right', rect: { x: width - right, y: top, width: right, height: middle } },
  ]

  for (const area of rules.otherAreas ?? []) {
    const { x, y, width: w, height: h } = area.bounds
    const fromRight = (area.anchor & ANCHOR_RIGHT) !== 0
    const fromBottom = (area.anchor & ANCHOR_BOTTOM) !== 0
    const pxWidth = Math.round(w * dpiX)
    const pxHeight = Math.round(h * dpiY)
    const pxX = fromRight ? width - Math.round(x * dpiX) : Math.round(x * dpiX)
    const pxY = fromBottom ? height - Math.round(y * dpiY) : Math.round(y * dpiY)
    const x0 = clamp(pxX, 0, width)
    const y0 = clamp(pxY, 0, height)
    const x1 = clamp(pxX + pxWidth, 0, width)
    const y1 = clamp(pxY + pxHeight, 0, height)
    if (x1 > x0 && y1 > y0) guides.push({ kind: 'keep-clear', rect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } })
  }

  return guides.filter((guide) => guide.rect.width > 0 && guide.rect.height > 0)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
