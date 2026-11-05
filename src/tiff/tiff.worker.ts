import UTIF, { type IFD } from 'utif'
import { drawRichText } from '../annotations/drawRichText'
import { isImageRun, type RichText } from '../annotations/richText'
import { BORDER_COLOR, BORDER_WIDTH_PT } from '../annotations/richText'
import { encodePage, type EncodedPage } from '../export/encodedPage'
import { pdfFile } from '../export/pdfFile'
import { copyOriginalPage, imageIfdOffsets, type TiffPage } from '../export/tiffCopy'
import { encodedTiffPage, tiffFile } from '../export/tiffFile'
import { detectSkew } from './deskew'
import { applyOps, type PageOp, type PixelOp, type TextOp } from './pageOps'
import type { ExportFormat, ExportPage, PageInfo, WorkerRequest, WorkerResponse } from './protocol'

/** A TIFF file: the opened one, or one whose pages were inserted. */
interface Source {
  buffer: ArrayBuffer
  ifds: IFD[]
}

interface Page {
  source: Source
  ifd: IFD
  /** Byte offset of this page's IFD in `source`, or -1 when the raw IFDs could not be matched up. */
  ifdOffset: number
}

/** Pages of the document, indexed like the main thread's pages: the opened file's, then each inserted file's. */
let pages: Page[] = []
/**
 * Every image a page has been shown as. Index 0 is the file as opened (or inserted). Later entries are
 * TIFFs a company's deskew or despeckle returned. Undo picks an earlier index; the bytes stay loaded.
 */
let pageRevisions: Page[][] = []

function post(message: WorkerResponse, transfer?: Transferable[]) {
  const scope = self as unknown as { postMessage(message: WorkerResponse, transfer: Transferable[]): void }
  scope.postMessage(message, transfer ?? [])
}

// NewSubfileType (tag 254) bit 0 marks reduced-resolution copies (thumbnails, pyramid levels).
function isReducedResolution(ifd: IFD): boolean {
  const subfileType: number = ifd.t254?.[0] ?? 0
  return (subfileType & 1) === 1
}

/** TIFF header: byte order ("II" or "MM") followed by 42 in that byte order. */
function isTiff(buffer: ArrayBuffer): boolean {
  const [a, b, c, d] = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength))
  return (a === 0x49 && b === 0x49 && c === 42 && d === 0) || (a === 0x4d && b === 0x4d && c === 0 && d === 42)
}

function readPages(buffer: ArrayBuffer): Page[] {
  if (!isTiff(buffer)) throw new Error('This is not a TIFF file.')
  const source: Source = { buffer, ifds: UTIF.decode(buffer) }
  let ifds = source.ifds.filter((ifd) => !isReducedResolution(ifd))
  if (ifds.length === 0) ifds = source.ifds
  if (ifds.length === 0) throw new Error('No images found in this TIFF file.')
  const offsets = imageIfdOffsets(buffer)
  // A mismatch means the raw walk and the decoded pages disagree, so every page is re-encoded.
  const located = offsets.length === ifds.length
  return ifds.map((ifd, index) => ({ source, ifd, ifdOffset: located ? offsets[index] : -1 }))
}

function open(data: ArrayBuffer): PageInfo[] {
  pages = readPages(data)
  pageRevisions = pages.map((page) => [page])
  decoded.clear()
  return pages.map(({ ifd }) => pageInfo(ifd))
}

/** Appends the pages of another file; returns their info. */
function add(data: ArrayBuffer): PageInfo[] {
  const added = readPages(data)
  pages.push(...added)
  pageRevisions.push(...added.map((page) => [page]))
  return added.map(({ ifd }) => pageInfo(ifd))
}

/**
 * The image `revision` of one page. Revision 0 is the opened (or inserted) page. Missing revisions fall
 * back to that, so a stale request still draws something.
 */
function pageAt(index: number, revision: number): Page {
  const list = pageRevisions[index]
  const page = list?.[revision] ?? list?.[0]
  if (!page) throw new Error(`Page ${index + 1} does not exist.`)
  return page
}

/** Saves `buffer` as the next image of each page in `indexes` (one TIFF page each, same order). */
function replacePages(buffer: ArrayBuffer, indexes: readonly number[]): { page: number; revision: number; info: PageInfo }[] {
  const added = readPages(buffer)
  const expected = indexes.length === 1 ? '1 page' : `${indexes.length} pages`
  const got = added.length === 1 ? '1 page' : `${added.length} pages`
  if (added.length !== indexes.length) throw new Error(`Expected ${expected}, got ${got}.`)
  for (const index of indexes) {
    if (!pageRevisions[index]) throw new Error(`Page ${index + 1} does not exist.`)
  }
  return indexes.map((index, i) => {
    const list = pageRevisions[index]
    list.push(added[i])
    return { page: index, revision: list.length - 1, info: pageInfo(added[i].ifd) }
  })
}

function pageInfo(ifd: IFD): PageInfo {
  return {
    width: ifd.t256?.[0] ?? 0,
    height: ifd.t257?.[0] ?? 0,
    dpiX: dotsPerInch(ifd, 't282'),
    dpiY: dotsPerInch(ifd, 't283'),
  }
}

/** XResolution (282) / YResolution (283) in dots per inch, using ResolutionUnit (296: 2 = inch, 3 = cm). */
function dotsPerInch(ifd: IFD, tag: 't282' | 't283'): number | null {
  const value: unknown = ifd[tag]?.[0]
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  const unit: number = ifd.t296?.[0] ?? 2
  if (unit === 2) return value
  if (unit === 3) return value * 2.54
  return null
}

/** Longest edge of generated thumbnails, in pixels (2x the sidebar's CSS size for high-DPI screens). */
const THUMBNAIL_SIZE = 240

/** Decoded (unedited) pages kept in memory so re-rendering after an edit doesn't decode again. */
const DECODED_CACHE_SIZE = 2
const decoded = new Map<string, OffscreenCanvas>()

function decodedKey(pageIndex: number, revision: number): string {
  return `${pageIndex}:${revision}`
}

function getDecodedPage(pageIndex: number, revision: number): OffscreenCanvas {
  const key = decodedKey(pageIndex, revision)
  let canvas = decoded.get(key)
  if (canvas) {
    decoded.delete(key)
  } else {
    canvas = decodePage(pageIndex, revision)
  }
  decoded.set(key, canvas)
  while (decoded.size > DECODED_CACHE_SIZE) decoded.delete(decoded.keys().next().value!)
  return canvas
}

/** Milliseconds since `mark`, to 0.1ms. */
function since(mark: number): number {
  return Math.round((performance.now() - mark) * 10) / 10
}

/** The page with its edits applied. Never modifies the cached decoded page. */
async function editedPage(
  pageIndex: number,
  revision: number,
  ops: readonly PageOp[],
  times?: { decode: number; edits: number },
): Promise<OffscreenCanvas> {
  const decodedAt = performance.now()
  const base = getDecodedPage(pageIndex, revision)
  if (times) times.decode = since(decodedAt)
  if (ops.length === 0) {
    if (times) times.edits = 0
    return base
  }

  const editsAt = performance.now()
  let canvas = toPaper(base, base.width, base.height)
  let pixelOps: PixelOp[] = []
  const flush = () => {
    if (pixelOps.length === 0) return
    const ctx = context(canvas)
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
    applyOps({ data: image.data, width: image.width, height: image.height }, pixelOps)
    ctx.putImageData(image, 0, 0)
    pixelOps = []
  }
  for (const op of ops) {
    if (op.type === 'paper') {
      flush()
      canvas = toPaper(canvas, op.width, op.height)
    } else if (op.type === 'text') {
      flush()
      await drawText(canvas, op)
    } else if (op.type === 'scale') {
      flush()
      canvas = scaleContent(canvas, op.factor)
    } else if (op.type === 'deskew') {
      flush()
      canvas = rotateContent(canvas, -op.angle)
    } else if (op.type === 'shift') {
      flush()
      canvas = shiftContent(canvas, op.dx, op.dy)
    } else {
      pixelOps.push(op)
    }
  }
  flush()
  if (times) times.edits = since(editsAt)
  return canvas
}

function strokeDash(dash: 'solid' | 'dashed' | 'dotted', width: number): number[] {
  if (dash === 'dashed') return [width * 4, width * 3]
  if (dash === 'dotted') return [width, width * 2]
  return []
}

/** Decodes each inline picture once so it can be drawn in the line. One that will not decode is skipped. */
async function annotationImages(text: RichText): Promise<Map<string, ImageBitmap>> {
  const urls = new Set<string>()
  for (const paragraph of text) {
    for (const run of paragraph.runs) {
      if (isImageRun(run)) urls.add(run.image)
    }
  }
  const images = new Map<string, ImageBitmap>()
  await Promise.all(
    [...urls].map(async (url) => {
      try {
        images.set(url, await createImageBitmap(await (await fetch(url)).blob()))
      } catch {
        // The gap stays the picture's size; the rest of the line still draws.
      }
    }),
  )
  return images
}

/** Draws an annotation's text starting at its box's on-screen top-left corner, upright for the page's rotation. */
async function drawText(canvas: OffscreenCanvas, op: TextOp) {
  const { x, y, width, height } = op.rect
  const rotation = ((op.rotation % 360) + 360) % 360
  const corner = {
    0: [x, y],
    90: [x, y + height],
    180: [x + width, y + height],
    270: [x + width, y],
  }[rotation as 0 | 90 | 180 | 270] ?? [x, y]
  const ctx = context(canvas)
  ctx.save()
  ctx.translate(corner[0], corner[1])
  ctx.rotate((-rotation * Math.PI) / 180)
  const [boxWidth, boxHeight] = rotation % 180 === 0 ? [width, height] : [height, width]
  if (op.opacity !== undefined) ctx.globalAlpha = Math.min(Math.max(op.opacity, 0), 1)
  let textTop = 0
  let fillHeight = boxHeight
  if (op.fill || op.valign === 'middle' || op.valign === 'bottom') {
    const measured = drawRichText(context(new OffscreenCanvas(Math.max(1, boxWidth), Math.max(1, boxHeight))), op.text, boxWidth, op.pxPerPt)
    if (op.valign === 'middle') textTop = Math.max(0, (boxHeight - measured) / 2)
    else if (op.valign === 'bottom') textTop = Math.max(0, boxHeight - measured)
    else fillHeight = Math.max(boxHeight, measured)
  }
  if (op.fill) {
    ctx.fillStyle = op.fill
    ctx.fillRect(0, 0, boxWidth, fillHeight)
  }
  if (op.picture) await drawPicture(ctx, op.picture, boxWidth, boxHeight)
  const images = await annotationImages(op.text)
  ctx.save()
  ctx.translate(0, textTop)
  let textHeight = 0
  try {
    textHeight = drawRichText(ctx, op.text, boxWidth, op.pxPerPt, images)
  } finally {
    for (const bitmap of images.values()) bitmap.close()
  }
  ctx.restore()
  if (op.border) {
    const lineWidth = BORDER_WIDTH_PT * op.pxPerPt
    ctx.strokeStyle = BORDER_COLOR
    ctx.lineWidth = lineWidth
    ctx.strokeRect(lineWidth / 2, lineWidth / 2, boxWidth - lineWidth, Math.max(boxHeight, textHeight) - lineWidth)
  }
  if (op.stroke && op.stroke.width > 0) {
    ctx.strokeStyle = op.stroke.color
    ctx.lineWidth = op.stroke.width
    ctx.setLineDash(strokeDash(op.stroke.dash, op.stroke.width))
    ctx.strokeRect(op.stroke.width / 2, op.stroke.width / 2, boxWidth - op.stroke.width, boxHeight - op.stroke.width)
  }
  ctx.restore()
}

/** Draws a rasterized image or HTML snapshot into the annotation box. A bad picture is skipped. */
async function drawPicture(ctx: OffscreenCanvasRenderingContext2D, picture: string, width: number, height: number) {
  try {
    const bitmap = await createImageBitmap(await (await fetch(picture)).blob())
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
  } catch {
    // The text still burns in when the snapshot cannot be decoded.
  }
}

/** A new white `width` x `height` canvas with `source` scaled to fit (aspect kept) and centered. */
function toPaper(source: OffscreenCanvas, width: number, height: number): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = context(canvas)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  const scale = Math.min(width / source.width, height / source.height)
  const drawWidth = Math.round(source.width * scale)
  const drawHeight = Math.round(source.height * scale)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, Math.round((width - drawWidth) / 2), Math.round((height - drawHeight) / 2), drawWidth, drawHeight)
  return canvas
}

/** Same-size white canvas with `source` scaled by `factor` around the center (edges cropped when enlarged). */
function scaleContent(source: OffscreenCanvas, factor: number): OffscreenCanvas {
  const canvas = new OffscreenCanvas(source.width, source.height)
  const ctx = context(canvas)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const width = source.width * factor
  const height = source.height * factor
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
  return canvas
}

/** Same-size white canvas with `source` moved by `dx`, `dy` (cropped at the edges, uncovered area white). */
function shiftContent(source: OffscreenCanvas, dx: number, dy: number): OffscreenCanvas {
  const canvas = new OffscreenCanvas(source.width, source.height)
  const ctx = context(canvas)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(source, dx, dy)
  return canvas
}

/** Same-size white canvas with `source` rotated `degrees` clockwise around the center (corners cropped / padded). */
function rotateContent(source: OffscreenCanvas, degrees: number): OffscreenCanvas {
  const canvas = new OffscreenCanvas(source.width, source.height)
  const ctx = context(canvas)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((degrees * Math.PI) / 180)
  ctx.drawImage(source, -source.width / 2, -source.height / 2)
  return canvas
}

function resize(source: OffscreenCanvas, width: number, height: number): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = context(canvas)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, width, height)
  return canvas
}

/** Longest edge the page is reduced to for skew detection; plenty for lines of text, and quick. */
const SKEW_DETECTION_SIZE = 1600

async function skewAngle(pageIndex: number, revision: number, ops: readonly PageOp[]): Promise<number> {
  const page = await editedPage(pageIndex, revision, ops)
  const scale = Math.min(1, SKEW_DETECTION_SIZE / Math.max(page.width, page.height))
  const small = scale < 1 ? resize(page, Math.round(page.width * scale), Math.round(page.height * scale)) : page
  const image = context(small).getImageData(0, 0, small.width, small.height)
  return detectSkew({ data: image.data, width: image.width, height: image.height })
}

/**
 * Paper white and near-white do not count as overlap. Anything darker than this luminance (0–255) is
 * treated as content in a margin / keep-clear region. (Despeckle uses a darker cut-off; warnings need
 * to catch light-gray print too, while ignoring scanner paper.)
 */
const NEAR_WHITE_LUMINANCE = 250
/** Longest edge for warning inspection; full-page getImageData at 300 dpi was blocking navigation. */
const INSPECT_MAX_EDGE = 800
/** Sample every Nth pixel on the (possibly downscaled) page. */
const REGION_SAMPLE_STEP = 2
/**
 * Minimum sampled dark pixels before a region counts as overlapping (at full resolution). Scaled down
 * with the inspection image so a few edge-noise pixels still do not warn.
 */
const MIN_INK_SAMPLES = 16

/**
 * Which of `regions` contain ink on the page with `ops` applied. Regions are in unrotated page pixels
 * (same space as guides and ops). White / near-white pixels and tiny speckles are ignored.
 * Uses one downscaled copy, drawn without smoothing and read once on that same context. Only samples
 * whose whole footprint sits inside the guide count, so ink just outside a keep-clear box (the skewed
 * page's tilted lines run along that edge) does not keep the warning after the box is cleared.
 */
async function inspectRegions(
  pageIndex: number,
  revision: number,
  ops: readonly PageOp[],
  regions: readonly { id: string; rect: { x: number; y: number; width: number; height: number } }[],
): Promise<string[]> {
  if (regions.length === 0) return []
  const full = await editedPage(pageIndex, revision, ops)
  const scale = Math.min(1, INSPECT_MAX_EDGE / Math.max(full.width, full.height))
  const width = Math.max(1, Math.round(full.width * scale))
  const height = Math.max(1, Math.round(full.height * scale))
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create a 2D canvas context.')
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(full, 0, 0, width, height)
  const { data, width: stride } = ctx.getImageData(0, 0, width, height)
  const minInk = Math.max(2, Math.round(MIN_INK_SAMPLES * scale * scale))
  const hits: string[] = []
  for (const { id, rect } of regions) {
    // Dest pixels that overlap the guide's edge also cover source pixels outside it. Leave those out.
    const x0 = Math.max(0, Math.ceil((rect.x * width) / full.width))
    const y0 = Math.max(0, Math.ceil((rect.y * height) / full.height))
    const x1 = Math.min(width, Math.floor(((rect.x + rect.width) * width) / full.width))
    const y1 = Math.min(height, Math.floor(((rect.y + rect.height) * height) / full.height))
    const rw = x1 - x0
    const rh = y1 - y0
    if (rw <= 0 || rh <= 0) continue
    let ink = 0
    for (let y = 0; y < rh; y += REGION_SAMPLE_STEP) {
      const row = (y0 + y) * stride
      for (let x = 0; x < rw; x += REGION_SAMPLE_STEP) {
        const i = (row + x0 + x) * 4
        if (data[i + 3] < 128) continue
        if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < NEAR_WHITE_LUMINANCE) {
          ink++
          if (ink >= minInk) break
        }
      }
      if (ink >= minInk) break
    }
    if (ink >= minInk) hits.push(id)
  }
  return hits
}

/**
 * The page as shown: edits applied, turned by `rotation` (a multiple of 90°), on white.
 * A straight page is returned as-is. `getImageData` does not change the canvas, and `editedPage`
 * returns the decode cache only when there are no ops, so that cache stays intact.
 */
async function orientedPage(
  pageIndex: number,
  revision: number,
  ops: readonly PageOp[],
  rotation: number,
  times?: { decode: number; edits: number; orient: number },
): Promise<OffscreenCanvas> {
  const page = await editedPage(pageIndex, revision, ops, times)
  const degrees = ((rotation % 360) + 360) % 360
  if (degrees === 0) {
    if (times) times.orient = 0
    return page
  }
  const orientAt = performance.now()
  const sideways = degrees % 180 !== 0
  const canvas = new OffscreenCanvas(sideways ? page.height : page.width, sideways ? page.width : page.height)
  const ctx = context(canvas)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((degrees * Math.PI) / 180)
  ctx.drawImage(page, -page.width / 2, -page.height / 2)
  if (times) times.orient = since(orientAt)
  return canvas
}

/** At most three redraws at once: this worker plus two helpers. Leaves a core for the page when there are fewer. */
function helperCount(jobs: number): number {
  if (jobs < 2) return 0
  const cores = navigator.hardwareConcurrency || 3
  return Math.max(0, Math.min(2, jobs - 1, cores - 1))
}

interface TimedRedraw {
  page: EncodedPage
  ms: number
  decode: number
  edits: number
  orient: number
  pixels: number
  encode: number
}

interface RedrawJob {
  index: number
  spec: ExportPage
  /** One-page TIFF of the original strips, for a helper. Null when the strips cannot be copied out. */
  slice: ArrayBuffer | null
  missed: boolean
}

/** One-page TIFF of `stored`, or null when those strips cannot be copied safely. */
async function pageSlice(stored: Page | undefined): Promise<ArrayBuffer | null> {
  if (!stored || stored.ifdOffset < 0) return null
  const copied = copyOriginalPage(stored.source.buffer, stored.ifdOffset, 0, 1)
  if (!copied) return null
  return tiffFile([copied]).arrayBuffer()
}

/**
 * Another copy of this worker. Built with `new Function` so the bundler does not treat it as a nested
 * worker of this file (that circular bundle never finishes loading).
 */
function spawnRedrawWorker(): Worker {
  const spawn = new Function('url', 'return new Worker(url, { type: "module" })') as (url: string) => Worker
  return spawn(self.location.href)
}

/**
 * Extra workers that redraw one page each. Each is given that page's strips, not the whole document.
 * Stopped when the export finishes.
 */
class RedrawHelpers {
  private readonly workers: Worker[] = []
  private readonly pending = new Map<number, { resolve: (page: TimedRedraw) => void; reject: (error: Error) => void }>()
  private nextId = 1
  readonly count: number

  constructor(count: number) {
    this.count = count
    for (let i = 0; i < count; i++) {
      const worker = spawnRedrawWorker()
      worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
        const response = event.data
        const waiting = this.pending.get(response.id)
        if (!waiting) return
        this.pending.delete(response.id)
        if (response.type === 'redrawn') waiting.resolve(timedFromRedrawn(response))
        else if (response.type === 'error') waiting.reject(new Error(response.message))
        else waiting.reject(new Error('Unexpected response from a redraw worker.'))
      })
      worker.addEventListener('error', () => {
        for (const waiting of this.pending.values()) waiting.reject(new Error('A redraw worker stopped.'))
        this.pending.clear()
      })
      this.workers.push(worker)
    }
  }

  redraw(index: number, buffer: ArrayBuffer, spec: ExportPage): Promise<TimedRedraw> {
    const worker = this.workers[index]
    const id = this.nextId++
    const result = new Promise<TimedRedraw>((resolve, reject) => this.pending.set(id, { resolve, reject }))
    worker.postMessage(
      { id, type: 'redraw-page', buffer, ops: spec.ops, rotation: spec.rotation, dpiX: spec.dpiX, dpiY: spec.dpiY },
      [buffer],
    )
    return result
  }

  stop() {
    for (const worker of this.workers) worker.terminate()
    this.workers.length = 0
    for (const waiting of this.pending.values()) waiting.reject(new Error('Export stopped.'))
    this.pending.clear()
  }
}

function timedFromRedrawn(response: Extract<WorkerResponse, { type: 'redrawn' }>): TimedRedraw {
  return {
    page: {
      width: response.width,
      height: response.height,
      dpiX: response.dpiX,
      dpiY: response.dpiY,
      gray: response.gray,
      data: new Uint8Array(response.data),
    },
    ms: response.ms,
    decode: response.decode,
    edits: response.edits,
    orient: response.orient,
    pixels: response.pixels,
    encode: response.encode,
  }
}

/**
 * Writes the pages in order. A TIFF copies the original compressed strips of a page that has no edits
 * and no rotation (deleted pages are simply absent; a new order is those strips in the new order).
 * Anything else is redrawn, up to three pages at a time. A PDF cannot reuse TIFF strips, so every page
 * of one is redrawn. `report` is how many pages are finished, in output order.
 */
async function exportPages(
  list: readonly ExportPage[],
  format: ExportFormat,
  report: (done: number, total: number) => void,
  note: (message: string) => void,
): Promise<Blob> {
  const started = performance.now()
  let copyCount = 0
  let copyMs = 0
  let redrawCount = 0
  let redrawMs = 0
  let slowest = ''
  let slowestMs = -1
  const timePage = (index: number, path: 'copy' | 'redraw', ms: number, detail: string) => {
    if (path === 'copy') {
      copyCount++
      copyMs += ms
    } else {
      redrawCount++
      redrawMs += ms
    }
    note(`[tiff export] ${format} page ${index + 1}/${list.length} ${path} ${ms}ms${detail}`)
    if (ms > slowestMs) {
      slowestMs = ms
      slowest = `page ${index + 1} ${path} ${ms}ms`
    }
  }

  const copied: (TiffPage | null)[] = new Array(list.length).fill(null)
  const redrawn: (EncodedPage | undefined)[] = new Array(list.length)
  const jobs: RedrawJob[] = []
  const ready = new Array<boolean>(list.length).fill(false)
  let prefix = 0
  const markReady = (index: number) => {
    ready[index] = true
    const before = prefix
    while (prefix < list.length && ready[prefix]) prefix++
    if (prefix > before && list.length > 1) report(prefix, list.length)
  }

  for (let i = 0; i < list.length; i++) {
    const spec = list[i]
    const rotation = ((spec.rotation % 360) + 360) % 360
    const stored = pageRevisions[spec.page]?.[spec.revision ?? 0] ?? pageRevisions[spec.page]?.[0]
    if (format === 'tiff' && rotation === 0 && spec.ops.length === 0 && stored && stored.ifdOffset >= 0) {
      const copyAt = performance.now()
      const original = copyOriginalPage(stored.source.buffer, stored.ifdOffset, i, list.length)
      if (original) {
        copied[i] = original
        timePage(i, 'copy', since(copyAt), ` file ${spec.page}`)
        markReady(i)
        continue
      }
    }
    jobs.push({
      index: i,
      spec,
      slice: await pageSlice(stored),
      missed: format === 'tiff' && rotation === 0 && spec.ops.length === 0,
    })
  }

  const pooled = jobs.filter((job) => job.slice)
  const helpers = new RedrawHelpers(helperCount(pooled.length))
  let poolCursor = 0
  let localCursor = 0
  const localJobs = jobs.filter((job) => !job.slice)
  const takePooled = () => (poolCursor < pooled.length ? pooled[poolCursor++] : null)
  const takeLocal = () => (localCursor < localJobs.length ? localJobs[localCursor++] : null)

  const finish = (job: RedrawJob, timed: TimedRedraw, worker: number | null) => {
    redrawn[job.index] = timed.page
    timePage(job.index, 'redraw', timed.ms, redrawDetail(job, timed, worker))
    markReady(job.index)
  }

  const localLoop = async () => {
    for (;;) {
      const job = takeLocal() ?? takePooled()
      if (!job) return
      finish(job, await timeRedraw(job.spec), helpers.count > 0 ? 0 : null)
    }
  }
  const helperLoop = async (index: number) => {
    for (;;) {
      const job = takePooled()
      if (!job?.slice) return
      finish(job, await helpers.redraw(index, job.slice, job.spec), index + 1)
    }
  }

  try {
    await Promise.all([localLoop(), ...Array.from({ length: helpers.count }, (_, index) => helperLoop(index))])
  } finally {
    helpers.stop()
  }

  const assembleAt = performance.now()
  const blob =
    format === 'pdf'
      ? pdfFile(list.map((_, i) => redrawn[i] ?? missingPage(i)))
      : tiffFile(list.map((_, i) => copied[i] ?? encodedTiffPage(redrawn[i] ?? missingPage(i), i, list.length)))
  const workers = redrawCount === 0 ? 0 : helpers.count + 1
  note(exportSummary(format, list.length, since(started), copyCount, copyMs, redrawCount, redrawMs, since(assembleAt), slowest, workers))
  return blob
}

function missingPage(index: number): never {
  throw new Error(`Page ${index + 1} was not written.`)
}

function redrawDetail(job: RedrawJob, timed: TimedRedraw, worker: number | null): string {
  const rot = ((job.spec.rotation % 360) + 360) % 360
  const where = worker === null ? '' : ` w${worker}`
  const miss = job.missed ? ' copy missed' : ''
  return (
    `${miss} file ${job.spec.page} decode ${timed.decode} edits ${timed.edits} orient ${timed.orient}` +
    ` pixels ${timed.pixels} encode ${timed.encode} ${timed.page.width}x${timed.page.height}` +
    ` ops ${job.spec.ops.length} rot ${rot}${where}`
  )
}

function exportSummary(
  format: ExportFormat,
  pages: number,
  totalMs: number,
  copyCount: number,
  copyMs: number,
  redrawCount: number,
  redrawMs: number,
  assembleMs: number,
  slowest: string,
  workers: number,
): string {
  const copy = `${copyCount} copied in ${Math.round(copyMs * 10) / 10}ms`
  const pool = workers > 1 ? ` on ${workers} workers` : ''
  const redraw = `${redrawCount} redrawn (sum ${Math.round(redrawMs * 10) / 10}ms)${pool}`
  const slow = slowest ? `, slowest ${slowest}` : ''
  return `[tiff export] ${format} ${pages} pages in ${totalMs}ms — ${copy}, ${redraw}, assemble ${assembleMs}ms${slow}`
}

/** Redraws one page and times decode, edits, rotation, the pixel read, and compression. */
async function timeRedraw(spec: ExportPage): Promise<TimedRedraw> {
  const started = performance.now()
  const times = { decode: 0, edits: 0, orient: 0 }
  const canvas = await orientedPage(spec.page, spec.revision ?? 0, spec.ops, spec.rotation, times)
  const pixelsAt = performance.now()
  const image = context(canvas).getImageData(0, 0, canvas.width, canvas.height)
  const pixels = since(pixelsAt)
  const sideways = (((spec.rotation % 360) + 360) % 360) % 180 !== 0
  const encodeAt = performance.now()
  const page = await encodePage(image, sideways ? spec.dpiY : spec.dpiX, sideways ? spec.dpiX : spec.dpiY)
  return { page, ms: since(started), decode: times.decode, edits: times.edits, orient: times.orient, pixels, encode: since(encodeAt) }
}

function context(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create a 2D canvas context.')
  return ctx
}

function decodeRgba(pageIndex: number, revision: number): { rgba: Uint8Array; width: number; height: number } {
  const { source, ifd } = pageAt(pageIndex, revision)

  UTIF.decodeImage(source.buffer, ifd, source.ifds)
  const rgba = UTIF.toRGBA8(ifd)
  const { width, height } = ifd
  ifd.data = undefined
  return { rgba, width, height }
}

function decodePage(pageIndex: number, revision: number): OffscreenCanvas {
  const { rgba, width, height } = decodeRgba(pageIndex, revision)
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create a 2D canvas context.')
  const pixels = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, width * height * 4)
  ctx.putImageData(new ImageData(pixels, width, height), 0, 0)
  return canvas
}

/**
 * Sidebar preview. Pages without edits are box-filtered straight from the decoded pixels, so a long
 * document doesn't build a full-size canvas and high-quality-resample it for every page (that resample
 * dominated thumbnail time past the first screenful). Edited pages still render fully, then take the
 * same filter from the canvas.
 */
async function thumbnailBlob(pageIndex: number, revision: number, ops: readonly PageOp[]): Promise<Blob> {
  if (ops.length === 0 && !decoded.has(decodedKey(pageIndex, revision))) {
    const { rgba, width, height } = decodeRgba(pageIndex, revision)
    return downscaleRgba(rgba, width, height, THUMBNAIL_SIZE).convertToBlob({ type: 'image/png' })
  }
  return makeThumbnail(await editedPage(pageIndex, revision, ops))
}

function makeThumbnail(source: OffscreenCanvas): Promise<Blob> {
  const image = context(source).getImageData(0, 0, source.width, source.height)
  return downscaleRgba(image.data, image.width, image.height, THUMBNAIL_SIZE).convertToBlob({ type: 'image/png' })
}

/** Averages source pixels into each thumbnail pixel so thin text survives the shrink. */
function downscaleRgba(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  maxEdge: number,
): OffscreenCanvas {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  const tw = Math.max(1, Math.round(width * scale))
  const th = Math.max(1, Math.round(height * scale))
  const canvas = new OffscreenCanvas(tw, th)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create a 2D canvas context.')
  if (tw === width && th === height) {
    const pixels = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, width * height * 4)
    ctx.putImageData(new ImageData(pixels, width, height), 0, 0)
    return canvas
  }

  const acc = new Uint32Array(tw * th * 4)
  const count = new Uint32Array(tw * th)
  const xBin = new Uint16Array(width)
  for (let x = 0; x < width; x++) xBin[x] = Math.min(tw - 1, ((x * tw) / width) | 0)

  for (let y = 0; y < height; y++) {
    const dy = Math.min(th - 1, ((y * th) / height) | 0)
    const src = y * width * 4
    const dstRow = dy * tw
    for (let x = 0; x < width; x++) {
      const dx = xBin[x]
      const di = (dstRow + dx) * 4
      const si = src + x * 4
      acc[di] += rgba[si]
      acc[di + 1] += rgba[si + 1]
      acc[di + 2] += rgba[si + 2]
      acc[di + 3] += rgba[si + 3]
      count[dstRow + dx]++
    }
  }

  const out = new Uint8ClampedArray(tw * th * 4)
  for (let i = 0; i < count.length; i++) {
    const n = count[i] || 1
    const o = i * 4
    out[o] = acc[o] / n
    out[o + 1] = acc[o + 1] / n
    out[o + 2] = acc[o + 2] / n
    out[o + 3] = acc[o + 3] / n
  }
  ctx.putImageData(new ImageData(out, tw, th), 0, 0)
  return canvas
}

async function render(pageIndex: number, revision: number, ops: readonly PageOp[]): Promise<{ blob: Blob; thumbnail: Blob }> {
  const canvas = await editedPage(pageIndex, revision, ops)
  const [blob, thumbnail] = await Promise.all([canvas.convertToBlob({ type: 'image/png' }), makeThumbnail(canvas)])
  return { blob, thumbnail }
}

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data
  try {
    switch (request.type) {
      case 'open':
        post({ id: request.id, type: 'opened', pages: open(request.buffer) })
        break
      case 'add':
        post({ id: request.id, type: 'added', pages: add(request.buffer) })
        break
      case 'replace':
        post({ id: request.id, type: 'replaced', pages: replacePages(request.buffer, request.pages) })
        break
      case 'render':
        post({
          id: request.id,
          type: 'rendered',
          page: request.page,
          ...(await render(request.page, request.revision, request.ops)),
        })
        break
      case 'thumbnail':
        post({
          id: request.id,
          type: 'thumbnail',
          page: request.page,
          blob: await thumbnailBlob(request.page, request.revision, request.ops),
        })
        break
      case 'redraw-page': {
        const previousPages = pages
        const previousRevisions = pageRevisions
        const cached = [...decoded.entries()]
        try {
          open(request.buffer)
          if (pages.length !== 1) throw new Error(`Expected 1 page, got ${pages.length} pages.`)
          const timed = await timeRedraw({
            page: 0,
            revision: 0,
            ops: request.ops,
            rotation: request.rotation,
            dpiX: request.dpiX,
            dpiY: request.dpiY,
          })
          const bytes = timed.page.data
          const data = new ArrayBuffer(bytes.byteLength)
          new Uint8Array(data).set(bytes)
          post(
            {
              id: request.id,
              type: 'redrawn',
              width: timed.page.width,
              height: timed.page.height,
              dpiX: timed.page.dpiX,
              dpiY: timed.page.dpiY,
              gray: timed.page.gray,
              data,
              ms: timed.ms,
              decode: timed.decode,
              edits: timed.edits,
              orient: timed.orient,
              pixels: timed.pixels,
              encode: timed.encode,
            },
            [data],
          )
        } finally {
          pages = previousPages
          pageRevisions = previousRevisions
          decoded.clear()
          for (const [key, canvas] of cached) decoded.set(key, canvas)
        }
        break
      }
      case 'export':
        post({
          id: request.id,
          type: 'exported',
          blob: await exportPages(
            request.pages,
            request.format,
            (done, total) => post({ id: request.id, type: 'export-progress', done, total }),
            (message) => post({ id: request.id, type: 'export-timing', message }),
          ),
        })
        break
      case 'skew':
        post({
          id: request.id,
          type: 'skew',
          page: request.page,
          angle: await skewAngle(request.page, request.revision, request.ops),
        })
        break
      case 'inspect-regions':
        post({
          id: request.id,
          type: 'regions-hit',
          page: request.page,
          hits: await inspectRegions(request.page, request.revision, request.ops, request.regions),
        })
        break
    }
  } catch (err) {
    post({ id: request.id, type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
})
