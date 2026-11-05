import type { EncodedPage } from './encodedPage'
import type { TiffEntry, TiffPage } from './tiffCopy'

const SHORT = 3
const LONG = 4
const RATIONAL = 5

interface PageLayout {
  end: number
  ifdOffset: number
  stripOffsets: number[]
  valueOffsets: Map<TiffEntry, number>
}

/**
 * A multi-page little-endian TIFF. Each page is either a re-encoded strip or a page copied from an
 * existing file (`tiffCopy`). Offsets are even. Classic TIFF offsets are 32-bit, so a file past 4 GB throws.
 */
export function tiffFile(pages: readonly TiffPage[]): Blob {
  const ordered = pages.map((page) => ({
    strips: page.strips,
    entries: page.entries.slice().sort((a, b) => a.tag - b.tag),
  }))
  const layouts: PageLayout[] = []
  let cursor = 8
  for (const page of ordered) {
    const layout = layoutPage(page, cursor)
    layouts.push(layout)
    cursor = layout.end
  }
  if (cursor > 0xffffffff) throw new Error('This TIFF is larger than 4 GB.')

  const header = new Uint8Array(8)
  const view = new DataView(header.buffer)
  view.setUint8(0, 0x49)
  view.setUint8(1, 0x49)
  view.setUint16(2, 42, true)
  view.setUint32(4, layouts[0]?.ifdOffset ?? 0, true)

  const parts: BlobPart[] = [header]
  let at = 8
  const write = (bytes: Uint8Array) => {
    parts.push(bytes)
    at += bytes.byteLength
  }
  const pad = () => {
    if (at & 1) write(new Uint8Array(1))
  }

  ordered.forEach((page, index) => {
    const layout = layouts[index]
    page.strips.forEach((strip, stripIndex) => {
      pad()
      if (at !== layout.stripOffsets[stripIndex]) throw new Error('TIFF strip layout mismatch.')
      if (strip.byteLength) write(strip)
    })
    for (const entry of page.entries) {
      const raw = rawValue(entry, layout.stripOffsets)
      if (raw.byteLength <= 4) continue
      pad()
      if (at !== layout.valueOffsets.get(entry)) throw new Error('TIFF value layout mismatch.')
      write(raw)
    }
    pad()
    if (at !== layout.ifdOffset) throw new Error('TIFF IFD layout mismatch.')
    write(ifdBytes(page, layout, layouts[index + 1]?.ifdOffset ?? 0))
  })
  return new Blob(parts, { type: 'image/tiff' })
}

/** A re-encoded page: one Deflate strip, grayscale when the pixels are gray, else RGB. */
export function encodedTiffPage(page: EncodedPage, index: number, total: number): TiffPage {
  const samples = page.gray ? 1 : 3
  return {
    strips: [page.data],
    entries: [
      { tag: 254, type: LONG, count: 1, value: leLong(0) },
      { tag: 256, type: LONG, count: 1, value: leLong(page.width) },
      { tag: 257, type: LONG, count: 1, value: leLong(page.height) },
      { tag: 258, type: SHORT, count: samples, value: page.gray ? leShorts([8]) : leShorts([8, 8, 8]) },
      { tag: 259, type: SHORT, count: 1, value: leShorts([8]) },
      { tag: 262, type: SHORT, count: 1, value: leShorts([page.gray ? 1 : 2]) },
      { tag: 273, type: LONG, count: 1, value: leLong(0), strips: true },
      { tag: 277, type: SHORT, count: 1, value: leShorts([samples]) },
      { tag: 278, type: LONG, count: 1, value: leLong(page.height) },
      { tag: 279, type: LONG, count: 1, value: leLong(page.data.byteLength) },
      { tag: 282, type: RATIONAL, count: 1, value: rational(page.dpiX) },
      { tag: 283, type: RATIONAL, count: 1, value: rational(page.dpiY) },
      { tag: 284, type: SHORT, count: 1, value: leShorts([1]) },
      { tag: 296, type: SHORT, count: 1, value: leShorts([2]) },
      { tag: 297, type: SHORT, count: 2, value: leShorts([index, total]) },
    ],
  }
}

function layoutPage(page: TiffPage, start: number): PageLayout {
  let cursor = start
  const stripOffsets: number[] = []
  const align = () => {
    if (cursor & 1) cursor++
  }
  for (const strip of page.strips) {
    align()
    stripOffsets.push(cursor)
    cursor += strip.byteLength
  }
  const valueOffsets = new Map<TiffEntry, number>()
  for (const entry of page.entries) {
    const raw = rawValue(entry, stripOffsets)
    if (raw.byteLength > 4) {
      align()
      valueOffsets.set(entry, cursor)
      cursor += raw.byteLength
    }
  }
  align()
  const ifdOffset = cursor
  cursor += 2 + page.entries.length * 12 + 4
  return { end: cursor, ifdOffset, stripOffsets, valueOffsets }
}

function ifdBytes(page: TiffPage, layout: PageLayout, next: number): Uint8Array {
  const bytes = new Uint8Array(2 + page.entries.length * 12 + 4)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, page.entries.length, true)
  page.entries.forEach((entry, i) => {
    const p = 2 + i * 12
    view.setUint16(p, entry.tag, true)
    view.setUint16(p + 2, entry.type, true)
    view.setUint32(p + 4, entry.count, true)
    const raw = rawValue(entry, layout.stripOffsets)
    if (raw.byteLength <= 4) {
      bytes.set(raw, p + 8)
    } else {
      const at = layout.valueOffsets.get(entry)
      if (at === undefined) throw new Error('TIFF value layout mismatch.')
      view.setUint32(p + 8, at, true)
    }
  })
  view.setUint32(2 + page.entries.length * 12, next, true)
  return bytes
}

function rawValue(entry: TiffEntry, stripOffsets: readonly number[]): Uint8Array {
  if (!entry.strips) return entry.value
  if (stripOffsets.length !== entry.count) throw new Error('TIFF strip count mismatch.')
  return leLongs(stripOffsets)
}

function leShorts(values: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 2)
  const view = new DataView(bytes.buffer)
  values.forEach((value, i) => view.setUint16(i * 2, value, true))
  return bytes
}

function leLong(value: number): Uint8Array {
  return leLongs([value])
}

function leLongs(values: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4)
  const view = new DataView(bytes.buffer)
  values.forEach((value, i) => view.setUint32(i * 4, value, true))
  return bytes
}

function rational(value: number): Uint8Array {
  const bytes = new Uint8Array(8)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, Math.round(value * 1000), true)
  view.setUint32(4, 1000, true)
  return bytes
}
