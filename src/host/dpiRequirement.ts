/**
 * DPI requirement: the resolution a company uses for positions, sizes and font sizes on the page as
 * displayed. The viewer scales those into the page's own pixels.
 *
 * A company asserts it before the app mounts with `window.tiffViewerDpiRequirement`, or any time with
 * `setDpiRequirement` / the host command `set-dpi-requirement`. `open-image` can set one for that document,
 * and `add-annotation`'s `dpi` overrides it for that command. Missing or invalid values use 300.
 */
import { ref } from 'vue'
import { pageResolution } from '../tiff/pageOps'
import type { PageInfo } from '../tiff/protocol'
import { rotateRect, unrotateRect, type ImageRect } from '../viewer/imageRect'

export const DEFAULT_DPI_REQUIREMENT = 300

const asserted = ref(DEFAULT_DPI_REQUIREMENT)

/** The company's DPI requirement. */
export function dpiRequirement(): number {
  return asserted.value
}

/** Assert the company's DPI requirement. A missing or non-positive value restores 300. */
export function setDpiRequirement(value: number | null | undefined) {
  const dpi = Number(value)
  asserted.value = dpi > 0 ? dpi : DEFAULT_DPI_REQUIREMENT
}

/** A positive DPI from a host field, or null when it isn't one. */
export function parseDpiRequirement(value: unknown): number | null {
  const dpi = Number(value)
  return dpi > 0 ? dpi : null
}

declare global {
  interface Window {
    /** DPI requirement read once, before the viewer mounts. */
    tiffViewerDpiRequirement?: number | null
  }
}

/** Page pixels per requirement pixel along the displayed page's x and y axes. */
function ratios(page: PageInfo, rotation: number, dpi: number): { x: number; y: number } {
  const { dpiX, dpiY } = pageResolution(page)
  const sideways = ((rotation % 360) + 360) % 180 !== 0
  return { x: (sideways ? dpiY : dpiX) / dpi, y: (sideways ? dpiX : dpiY) / dpi }
}

/**
 * A rect the host gives in DPI-requirement pixels on the page as displayed, in page pixels of the
 * unrotated page; kept on the page.
 */
export function requirementRectToPage(rect: ImageRect, page: PageInfo, rotation: number, dpi: number): ImageRect {
  const ratio = ratios(page, rotation, dpi)
  const sideways = ((rotation % 360) + 360) % 180 !== 0
  const width = sideways ? page.height : page.width
  const height = sideways ? page.width : page.height
  const clamp = (value: number, max: number) => Math.min(Math.max(Math.round(value), 0), max)
  const x = clamp(rect.x * ratio.x, width - 1)
  const y = clamp(rect.y * ratio.y, height - 1)
  const displayed = {
    x,
    y,
    width: Math.max(1, clamp(rect.width * ratio.x, width - x)),
    height: Math.max(1, clamp(rect.height * ratio.y, height - y)),
  }
  return unrotateRect(displayed, rotation, page.width, page.height)
}

/** The inverse of requirementRectToPage: unrotated page pixels to DPI-requirement pixels on the displayed page. */
export function pageRectToRequirement(rect: ImageRect, page: PageInfo, rotation: number, dpi: number): ImageRect {
  const ratio = ratios(page, rotation, dpi)
  const displayed = rotateRect(rect, rotation, page.width, page.height)
  return {
    x: Math.round(displayed.x / ratio.x),
    y: Math.round(displayed.y / ratio.y),
    width: Math.round(displayed.width / ratio.x),
    height: Math.round(displayed.height / ratio.y),
  }
}
