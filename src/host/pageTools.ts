/**
 * A company's own deskew or despeckle. The built-in tools run unless the company takes one over.
 *
 * Same-origin: set `window.tiffViewerPageTools.deskew` / `.despeckle` to a function. It is given a TIFF of
 * the pages (pending edits included, rotation not applied) and returns a TIFF with one page each, in the
 * same order, or null when there is nothing to change.
 *
 * Cross-origin (the usual iframe): `set-page-tools` with `deskew: true` and/or `despeckle: true`. A click
 * then sends `page-tool-requested`, and the host answers with `page-tool-result`.
 */
import { reactive } from 'vue'

export type PageToolName = 'deskew' | 'despeckle'

/** What a company's deskew or despeckle is asked to process. */
export interface PageToolRequest {
  /** TIFF of the pages, in `pageIndexes` order. Pending edits are already drawn in. Rotation is not. */
  buffer: ArrayBuffer
  /** `page` is the selected pages. `all` is every visible page. */
  scope: 'page' | 'all'
  /** Display position of each page in `buffer` (0 = the first page on screen). */
  pageIndexes: number[]
}

/**
 * The company's function. Return a TIFF (one page per input page, same order), or null / undefined when
 * the pages should be left as they are. A rejected promise is shown as an error and changes nothing.
 */
export type PageTool = (
  request: PageToolRequest,
) => Promise<Blob | ArrayBuffer | Uint8Array | null | undefined> | Blob | ArrayBuffer | Uint8Array | null | undefined

/** True when that tool is handled by the host via `page-tool-requested` instead of the built-in. */
export const hostPageTools = reactive<Record<PageToolName, boolean>>({ deskew: false, despeckle: false })

/** True when `window.tiffViewerPageTools` has a function for that tool. Updated when the toolbar is entered. */
export const pageToolFunctions = reactive<Record<PageToolName, boolean>>({ deskew: false, despeckle: false })

declare global {
  interface Window {
    /**
     * Company deskew / despeckle. Read when the button is clicked, so it can be set after the viewer loads
     * (same origin: `iframe.contentWindow.tiffViewerPageTools = { deskew, despeckle }`).
     */
    tiffViewerPageTools?: Partial<Record<PageToolName, PageTool | null>>
  }
}

/** Reads `window.tiffViewerPageTools` so the toolbar hint matches a function set after the viewer loaded. */
export function syncPageToolFunctions() {
  for (const tool of ['deskew', 'despeckle'] as const) {
    pageToolFunctions[tool] = typeof window.tiffViewerPageTools?.[tool] === 'function'
  }
}

/** The function currently set for `tool`, or null when the built-in (or the host round trip) should run. */
export function pageToolFunction(tool: PageToolName): PageTool | null {
  syncPageToolFunctions()
  const fn = window.tiffViewerPageTools?.[tool]
  return typeof fn === 'function' ? fn : null
}

/**
 * `true` hands that tool to the host. `false` restores the built-in. A field left out is left as it is.
 * A `window.tiffViewerPageTools` function still wins over this when the button is clicked.
 */
export function setHostPageTools(update: { deskew?: boolean; despeckle?: boolean }) {
  if (update.deskew !== undefined) hostPageTools.deskew = update.deskew
  if (update.despeckle !== undefined) hostPageTools.despeckle = update.despeckle
}

/** Bytes from a company's return value, or null when it asked for no change. */
export async function pageToolBytes(result: Blob | ArrayBuffer | Uint8Array | null | undefined): Promise<ArrayBuffer | null> {
  if (result == null) return null
  if (result instanceof Blob) {
    const buffer = await result.arrayBuffer()
    return buffer.byteLength > 0 ? buffer : null
  }
  if (result instanceof ArrayBuffer) return result.byteLength > 0 ? result : null
  if (ArrayBuffer.isView(result)) {
    if (result.byteLength === 0) return null
    const copy = new ArrayBuffer(result.byteLength)
    new Uint8Array(copy).set(new Uint8Array(result.buffer, result.byteOffset, result.byteLength))
    return copy
  }
  return null
}
