import UTIF, { type IFD } from 'utif'
import { drawRichText } from '../annotations/drawRichText'
import { isImageRun, type RichText } from '../annotations/richText'
import { BORDER_COLOR, BORDER_WIDTH_PT } from '../annotations/richText'
import { encodePage, type EncodedPage } from '../export/encodedPage'
import { pdfFile } from '../export/pdfFile'
import { tiffFile } from '../export/tiffFile'
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
}

/** Pages of the document, indexed like the main thread's pages: the opened file's, then each inserted file's. */
let pages: Page[] = []

function post(message: WorkerResponse) {
  self.postMessage(message)
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
  return ifds.map((ifd) => ({ source, ifd }))
}

function open(data: ArrayBuffer): PageInfo[] {
  pages = readPages(data)
  decoded.clear()
  return pages.map(({ ifd }) => pageInfo(ifd))
}

/** Appends the pages of another file; returns their info. */
function add(data: ArrayBuffer): PageInfo[] {
  const added = readPages(data)
  pages.push(...added)
  return added.map(({ ifd }) => pageInfo(ifd))
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
const decoded = new Map<number, OffscreenCanvas>()

function getDecodedPage(pageIndex: number): OffscreenCanvas {
  let canvas = decoded.get(pageIndex)
  if (canvas) {
    decoded.delete(pageIndex)
  } else {
    canvas = decodePage(pageIndex)
  }
  decoded.set(pageIndex, canvas)
  while (decoded.size > DECODED_CACHE_SIZE) decoded.delete(decoded.keys().next().value!)
  return canvas
}

/** The page with its edits applied. Never modifies the cached decoded page. */
async function editedPage(pageIndex: number, ops: readonly PageOp[]): Promise<OffscreenCanvas> {
  const base = getDecodedPage(pageIndex)
  if (ops.length === 0) return base

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

async function skewAngle(pageIndex: number, ops: readonly PageOp[]): Promise<number> {
  const page = await editedPage(pageIndex, ops)
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
  ops: readonly PageOp[],
  regions: readonly { id: string; rect: { x: number; y: number; width: number; height: number } }[],
): Promise<string[]> {
  if (regions.length === 0) return []
  const full = await editedPage(pageIndex, ops)
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

/** The page as shown: edits applied, turned by `rotation` (a multiple of 90°), on white. */
async function orientedPage(pageIndex: number, ops: readonly PageOp[], rotation: number): Promise<OffscreenCanvas> {
  const page = await editedPage(pageIndex, ops)
  const degrees = ((rotation % 360) + 360) % 360
  const sideways = degrees % 180 !== 0
  const canvas = new OffscreenCanvas(sideways ? page.height : page.width, sideways ? page.width : page.height)
  const ctx = context(canvas)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((degrees * Math.PI) / 180)
  ctx.drawImage(page, -page.width / 2, -page.height / 2)
  return canvas
}

/** Renders and compresses the pages one at a time, then writes them to one file. */
async function exportPages(pages: readonly ExportPage[], format: ExportFormat): Promise<Blob> {
  const encoded: EncodedPage[] = []
  for (const { page, ops, rotation, dpiX, dpiY } of pages) {
    const canvas = await orientedPage(page, ops, rotation)
    const image = context(canvas).getImageData(0, 0, canvas.width, canvas.height)
    const sideways = (((rotation % 360) + 360) % 360) % 180 !== 0
    encoded.push(await encodePage(image, sideways ? dpiY : dpiX, sideways ? dpiX : dpiY))
  }
  return format === 'pdf' ? pdfFile(encoded) : tiffFile(encoded)
}

function context(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create a 2D canvas context.')
  return ctx
}

function decodeRgba(pageIndex: number): { rgba: Uint8Array; width: number; height: number } {
  const page = pages[pageIndex]
  if (!page) throw new Error(`Page ${pageIndex + 1} does not exist.`)
  const { source, ifd } = page

  UTIF.decodeImage(source.buffer, ifd, source.ifds)
  const rgba = UTIF.toRGBA8(ifd)
  const { width, height } = ifd
  ifd.data = undefined
  return { rgba, width, height }
}

function decodePage(pageIndex: number): OffscreenCanvas {
  const { rgba, width, height } = decodeRgba(pageIndex)
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
async function thumbnailBlob(pageIndex: number, ops: readonly PageOp[]): Promise<Blob> {
  if (ops.length === 0 && !decoded.has(pageIndex)) {
    const { rgba, width, height } = decodeRgba(pageIndex)
    return downscaleRgba(rgba, width, height, THUMBNAIL_SIZE).convertToBlob({ type: 'image/png' })
  }
  return makeThumbnail(await editedPage(pageIndex, ops))
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

async function render(pageIndex: number, ops: readonly PageOp[]): Promise<{ blob: Blob; thumbnail: Blob }> {
  const canvas = await editedPage(pageIndex, ops)
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
      case 'render':
        post({ id: request.id, type: 'rendered', page: request.page, ...(await render(request.page, request.ops)) })
        break
      case 'thumbnail':
        post({
          id: request.id,
          type: 'thumbnail',
          page: request.page,
          blob: await thumbnailBlob(request.page, request.ops),
        })
        break
      case 'export':
        post({ id: request.id, type: 'exported', blob: await exportPages(request.pages, request.format) })
        break
      case 'skew':
        post({ id: request.id, type: 'skew', page: request.page, angle: await skewAngle(request.page, request.ops) })
        break
      case 'inspect-regions':
        post({
          id: request.id,
          type: 'regions-hit',
          page: request.page,
          hits: await inspectRegions(request.page, request.ops, request.regions),
        })
        break
    }
  } catch (err) {
    post({ id: request.id, type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
})
