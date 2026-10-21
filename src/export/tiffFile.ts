import type { EncodedPage } from './encodedPage'

const SHORT = 3
const LONG = 4
const RATIONAL = 5

const ENTRY_COUNT = 15
const IFD_SIZE = 2 + ENTRY_COUNT * 12 + 4
/** After each IFD: BitsPerSample (3 shorts, RGB only), XResolution and YResolution (2 longs each). */
const EXTRA_SIZE = 6 + 8 + 8

/** A multi-page little-endian TIFF: one Deflate-compressed strip per page, with resolution and page numbers. */
export function tiffFile(pages: readonly EncodedPage[]): Blob {
  const layout: { dataOffset: number; ifdOffset: number }[] = []
  let offset = 8
  for (const page of pages) {
    const dataOffset = offset
    offset += page.data.length + (page.data.length % 2)
    layout.push({ dataOffset, ifdOffset: offset })
    offset += IFD_SIZE + EXTRA_SIZE
  }

  const header = new DataView(new ArrayBuffer(8))
  header.setUint8(0, 0x49)
  header.setUint8(1, 0x49)
  header.setUint16(2, 42, true)
  header.setUint32(4, layout[0]?.ifdOffset ?? 0, true)

  const parts: BlobPart[] = [header.buffer]
  pages.forEach((page, index) => {
    const { dataOffset, ifdOffset } = layout[index]
    parts.push(page.data)
    if (page.data.length % 2) parts.push(new Uint8Array(1))

    const ifd = new DataView(new ArrayBuffer(IFD_SIZE + EXTRA_SIZE))
    const extra = IFD_SIZE
    const bitsOffset = ifdOffset + extra
    const xResOffset = bitsOffset + 6
    const yResOffset = xResOffset + 8
    const samples = page.gray ? 1 : 3
    const entries: [tag: number, type: number, count: number, value: number | [number, number]][] = [
      [254, LONG, 1, 0],
      [256, LONG, 1, page.width],
      [257, LONG, 1, page.height],
      [258, SHORT, samples, page.gray ? 8 : bitsOffset],
      [259, SHORT, 1, 8],
      [262, SHORT, 1, page.gray ? 1 : 2],
      [273, LONG, 1, dataOffset],
      [277, SHORT, 1, samples],
      [278, LONG, 1, page.height],
      [279, LONG, 1, page.data.length],
      [282, RATIONAL, 1, xResOffset],
      [283, RATIONAL, 1, yResOffset],
      [284, SHORT, 1, 1],
      [296, SHORT, 1, 2],
      [297, SHORT, 2, [index, pages.length]],
    ]
    ifd.setUint16(0, entries.length, true)
    entries.forEach(([tag, type, count, value], i) => {
      const p = 2 + i * 12
      ifd.setUint16(p, tag, true)
      ifd.setUint16(p + 2, type, true)
      ifd.setUint32(p + 4, count, true)
      if (Array.isArray(value)) {
        ifd.setUint16(p + 8, value[0], true)
        ifd.setUint16(p + 10, value[1], true)
      } else if (type === SHORT && count === 1) {
        ifd.setUint16(p + 8, value, true)
      } else {
        ifd.setUint32(p + 8, value, true)
      }
    })
    ifd.setUint32(2 + entries.length * 12, layout[index + 1]?.ifdOffset ?? 0, true)
    for (let i = 0; i < 3; i++) ifd.setUint16(extra + i * 2, 8, true)
    writeRational(ifd, extra + 6, page.dpiX)
    writeRational(ifd, extra + 14, page.dpiY)
    parts.push(ifd.buffer)
  })
  return new Blob(parts, { type: 'image/tiff' })
}

function writeRational(view: DataView, offset: number, value: number) {
  view.setUint32(offset, Math.round(value * 1000), true)
  view.setUint32(offset + 4, 1000, true)
}
