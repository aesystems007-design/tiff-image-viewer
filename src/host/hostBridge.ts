/**
 * Talks to the app hosting the viewer. Events go out as `postMessage` to the parent window (viewer in an
 * iframe) and the opener (viewer in a popup), and as a `CustomEvent` on `window` (`tiff-image-viewer:<type>`)
 * for scripts in the viewer's own page. Commands come in as `postMessage`.
 *
 * The host owns storage. It pushes image bytes in with `open-image` and
 * handles Apply via `save-requested` → `save-acked` / `save-failed`.
 */

import { marginSpecFromHost, type MarginSpec } from '../margins/margins'
import { allowedPageSizeFromHost, type AllowedPageSizeRule } from './allowedPageSize'
import { parseDpiRequirement } from './dpiRequirement'
import type { AnnotationKind, UneditableAnnotation } from './uneditableAnnotation'

const SOURCE = 'tiff-image-viewer'
/** When set, events are only posted to this origin and commands from other origins are ignored. */
const HOST_ORIGIN = import.meta.env.VITE_HOST_ORIGIN || '*'

/** Every event carries `source: 'tiff-image-viewer'`. */
export type ViewerEvent =
  /** The image has (or no longer has) changes that weren't applied. Sent only when it flips. */
  | { type: 'dirty-change'; id: string | null; dirty: boolean }
  | { type: 'document-loaded'; id: string | null }
  /** Apply finished and the host confirmed the upload (`save-acked`), or a standalone save succeeded. */
  | { type: 'document-saved'; id: string }
  /**
   * User clicked Apply on a document that has an `id`, while hosted: the edited TIFF is in `buffer`
   * (transferred to the parent/opener). The host should store it, then send `save-acked` or `save-failed`.
   */
  | { type: 'save-requested'; id: string; name: string; buffer: ArrayBuffer }
  /**
   * A file was dropped on the viewer while it is hosted. The viewer does not open it: `buffer` is the
   * file as dropped (transferred), so the host can run its own load (for example `tiffHostLoadImage`)
   * and then `open-image`.
   */
  | { type: 'file-dropped'; name: string; buffer: ArrayBuffer }
  /** Answer to `add-annotation` (like the old viewer's addStamp result); `requestId` as sent. */
  | {
      type: 'annotation-result'
      requestId: string | number | null
      status: 'Success' | 'Error'
      message: string
      annotationId?: number
    }
  /**
   * Answer to `burn-annotations`. On success the overlays are gone and the text is a pending page edit
   * (saved on the next Apply). Each uneditable annotation is the object as sent, with `left` / `top` and
   * `pageIndex` of where it was drawn.
   */
  | {
      type: 'annotations-burned'
      requestId: string | number | null
      status: 'Success' | 'Error'
      message: string
      annotations: BurnedAnnotation[]
    }
  /**
   * Answer to `remove-uneditable-annotation`. On success that one overlay is gone (it was not drawn into
   * the page). `remaining` is how many uneditable overlays are still on the document.
   */
  | {
      type: 'uneditable-annotation-removed'
      requestId: string | number | null
      status: 'Success' | 'Error'
      message: string
      annotationId?: number
      remaining: number
    }

/** One annotation in an `annotations-burned` event. */
export interface BurnedAnnotation {
  annotationId: number
  type: AnnotationKind
  requestId: string | number | null
  /** Display position (0 = first page) of the page it was drawn on. */
  pageIndex: number
  /** Uneditable only: the object as sent, placed where it was burned. */
  annotation?: UneditableAnnotation
  /** Uneditable only: size of its page as displayed, in DPI-requirement pixels. */
  pageSize?: { width: number; height: number }
}

/**
 * Commands are posted as `{ target: 'tiff-image-viewer', type, ... }`.
 * For `open-image`, transfer the TIFF with `postMessage(msg, origin, [msg.buffer])`.
 */
export type HostCommand =
  /**
   * Host is calling GetDocumentImage (and then maybe GetDocumentTiff / upload). Viewer shows Loading until
   * `open-image` or `image-missing` (or `image-cleared`).
   */
  | { type: 'image-loading'; id: string | null }
  /**
   * Host has the TIFF bytes. `id` is the host's own key for this document (any string, or a number);
   * omit it when the image is not stored under a key. With an `id`, Apply asks the host to save.
   */
  | {
      type: 'open-image'
      id: string | null
      name: string
      buffer: ArrayBuffer
      /** Margin rules for this document; null = draw nothing. */
      margins: MarginSpec | null
      /** This document's DPI requirement; null = use the company's asserted requirement. */
      dpiRequirement: number | null
      /**
       * Paper size this document's pages must be, and how far (inches) they may sit under / over it.
       * `ANY` does not warn. Missing values are `ANY` with no slack.
       */
      allowedPageSize: AllowedPageSizeRule
    }
  /**
   * The host has no image for this document. Viewer stops Loading and shows
   * "No image found, please upload a new image."
   */
  | { type: 'image-missing'; id: string | null }
  /** Host cancelled / cleared; viewer resets to the generic empty state. */
  | { type: 'image-cleared' }
  /** Host stored the Apply TIFF; viewer commits pending edits. `id` must match `save-requested`. */
  | { type: 'save-acked'; id: string }
  /** Host could not store the Apply TIFF; viewer stays dirty and shows `message`. */
  | { type: 'save-failed'; id: string; message: string }
  /**
   * Dev / standalone shortcut: viewer fetches the document itself. Prefer `open-image` when the host
   * supplies the bytes.
   */
  | { type: 'load-document'; id: string }
  /** Replace the open document's key. `null` clears it, so the next Apply commits in memory only. */
  | { type: 'set-id'; id: string | null }
  /**
   * Adds an annotation. `annotation.type` is `'Editable'` or `'Uneditable'` (`stampType: 'UneditableAnnotation'`
   * or `'FillInStamp'` still means Uneditable). Editable replaces the one with the same name (the VerbiageStamp).
   * `dpi` is the DPI requirement its coordinates are in (the company's, else 300).
   */
  | { type: 'add-annotation'; annotation: unknown; dpi: number | null; requestId: string | number | null }
  /**
   * Draws every annotation into its page and removes the overlays. The drawing is a pending edit, saved on Apply.
   */
  | { type: 'burn-annotations'; requestId: string | number | null }
  /**
   * Removes one uneditable overlay. `annotationId` is the id from `annotation-result` when it was added.
   * Does not draw it into the page and does not dirty the document. A host loops this to clear them all.
   */
  | { type: 'remove-uneditable-annotation'; annotationId: number | null; requestId: string | number | null }
  /**
   * Replace built-in icons. Each value is an image URL or one `<svg>` element; null restores that icon.
   * Names are the keys in `src/icons/icons.ts`.
   */
  | { type: 'set-icons'; icons: Record<string, string | null> }
  /**
   * The company's Dynamic Web TWAIN product key. Empty or null hides the scan button.
   * The key is not echoed back in any event.
   */
  | { type: 'set-scan-license'; productKey: string | null }
  /**
   * Assert the company's DPI requirement (positions and font sizes on `add-annotation`).
   * A missing or non-positive value restores 300. A document's own `open-image` value still wins.
   */
  | { type: 'set-dpi-requirement'; dpiRequirement: number | null }
  /**
   * Margin rules for the open document (same object as `open-image`). Null, or a spec with nothing to draw,
   * clears them. Guides update in place; this does not dirty the document or reopen the image.
   */
  | { type: 'set-margins'; margins: MarginSpec | null }
  /**
   * Allowed paper size for the open document, same fields as `open-image` (`allowedPageSize`, `threshold`).
   * `ANY`, or a missing size, clears the page-size warnings. Does not dirty the document or reopen the image.
   */
  | { type: 'set-allowed-page-size'; allowedPageSize: AllowedPageSizeRule }

/**
 * `?viewerId=` in the page URL: echoed in every event so a host running several viewers (tabs) can tell them
 * apart without matching `event.source`.
 */
const VIEWER_ID = new URLSearchParams(window.location.search).get('viewerId') || null

/** True when the viewer is in an iframe or opened as a popup (a host is expected to handle saves). */
export function isHosted(): boolean {
  return window.parent !== window || !!window.opener
}

export function notifyHost(event: ViewerEvent) {
  const base = { source: SOURCE, ...(VIEWER_ID ? { viewerId: VIEWER_ID } : {}) }
  // CustomEvent gets a structured clone (including a copy of any ArrayBuffer) before we transfer.
  window.dispatchEvent(new CustomEvent(`${SOURCE}:${event.type}`, { detail: { ...base, ...event } }))
  const targets = [...new Set([window.parent, window.opener as Window | null])].filter(
    (target): target is Window => !!target && target !== window,
  )
  targets.forEach((target, index) => {
    if (event.type === 'save-requested' || event.type === 'file-dropped') {
      // Transfer a dedicated copy per target so posting to parent and opener both work.
      const buffer = index === targets.length - 1 ? event.buffer : event.buffer.slice(0)
      target.postMessage({ ...base, ...event, buffer }, HOST_ORIGIN, [buffer])
    } else {
      target.postMessage({ ...base, ...event }, HOST_ORIGIN)
    }
  })
}

/**
 * The host's document key. A string (trimmed; blank counts as none) or a finite number, which is stored
 * as its decimal text. Anything else is none.
 */
export function documentId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string') {
    const text = value.trim()
    return text || null
  }
  return null
}

/** `dpiRequirement`, or `countyDpi` when that was not sent. */
function messageDpi(message: Record<string, unknown>): number | null {
  if ('dpiRequirement' in message) return parseDpiRequirement(message.dpiRequirement)
  if ('countyDpi' in message) return parseDpiRequirement(message.countyDpi)
  return null
}

/** `id`, or `docId` when `id` was not sent. */
function messageId(message: Record<string, unknown>): string | null {
  if ('id' in message) return documentId(message.id)
  if ('docId' in message) return documentId(message.docId)
  return null
}

function parseCommand(data: unknown): HostCommand | null {
  if (!data || typeof data !== 'object') return null
  const message = data as Record<string, unknown>
  if (message.target !== SOURCE) return null

  if (message.type === 'image-loading') {
    return { type: 'image-loading', id: messageId(message) }
  }

  if (message.type === 'open-image') {
    const name = typeof message.name === 'string' && message.name ? message.name : 'document.tif'
    const buffer = message.buffer
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) return null
    return {
      type: 'open-image',
      id: messageId(message),
      name,
      buffer,
      margins: marginSpecFromHost(message.margins),
      dpiRequirement: messageDpi(message),
      allowedPageSize: allowedPageSizeFromHost(message.allowedPageSize, message.threshold),
    }
  }

  if (message.type === 'image-missing') {
    return { type: 'image-missing', id: messageId(message) }
  }

  if (message.type === 'image-cleared') return { type: 'image-cleared' }

  if (message.type === 'save-acked') {
    const id = messageId(message)
    if (id) return { type: 'save-acked', id }
  }

  if (message.type === 'save-failed') {
    const id = messageId(message)
    if (id) {
      const text = typeof message.message === 'string' && message.message ? message.message : 'Save failed.'
      return { type: 'save-failed', id, message: text }
    }
  }

  if (message.type === 'load-document') {
    const id = messageId(message)
    if (id) return { type: 'load-document', id }
  }

  if (message.type === 'set-id' && ('id' in message || 'docId' in message)) {
    return { type: 'set-id', id: messageId(message) }
  }

  if (message.type === 'add-annotation') {
    const dpi = Number(message.dpi)
    const requestId = typeof message.requestId === 'string' || typeof message.requestId === 'number' ? message.requestId : null
    return { type: 'add-annotation', annotation: message.annotation, dpi: dpi > 0 ? dpi : null, requestId }
  }

  if (message.type === 'burn-annotations') {
    const requestId = typeof message.requestId === 'string' || typeof message.requestId === 'number' ? message.requestId : null
    return { type: 'burn-annotations', requestId }
  }

  if (message.type === 'remove-uneditable-annotation') {
    const requestId = typeof message.requestId === 'string' || typeof message.requestId === 'number' ? message.requestId : null
    const id = message.annotationId
    const annotationId = typeof id === 'number' && Number.isInteger(id) ? id : null
    return { type: 'remove-uneditable-annotation', annotationId, requestId }
  }

  if (message.type === 'set-icons' && message.icons && typeof message.icons === 'object') {
    const icons: Record<string, string | null> = {}
    for (const [name, value] of Object.entries(message.icons as Record<string, unknown>)) {
      if (value === null || value === '') icons[name] = null
      else if (typeof value === 'string') icons[name] = value
    }
    return { type: 'set-icons', icons }
  }

  if (message.type === 'set-scan-license') {
    if (message.productKey === null || message.productKey === '') return { type: 'set-scan-license', productKey: null }
    if (typeof message.productKey === 'string') return { type: 'set-scan-license', productKey: message.productKey }
  }

  if (message.type === 'set-dpi-requirement') {
    return { type: 'set-dpi-requirement', dpiRequirement: messageDpi(message) }
  }

  if (message.type === 'set-margins') {
    return { type: 'set-margins', margins: marginSpecFromHost(message.margins) }
  }

  if (message.type === 'set-allowed-page-size') {
    return { type: 'set-allowed-page-size', allowedPageSize: allowedPageSizeFromHost(message.allowedPageSize, message.threshold) }
  }

  return null
}

/** Calls `handler` for every command from the host; returns a function that stops listening. */
export function listenToHost(handler: (command: HostCommand) => void): () => void {
  const onMessage = (event: MessageEvent) => {
    if (HOST_ORIGIN !== '*' && event.origin !== HOST_ORIGIN) return
    const command = parseCommand(event.data)
    if (command) handler(command)
  }
  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}

/** Document key to load on start, from `?id=` (or `?docId=`). Standalone only, when the host does not open the image. */
export function initialDocumentId(): string | null {
  const params = new URLSearchParams(window.location.search)
  return documentId(params.get('id')) ?? documentId(params.get('docId'))
}
