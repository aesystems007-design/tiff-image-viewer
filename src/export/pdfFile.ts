import type { EncodedPage } from './encodedPage'

/** A PDF with one page per image, each page sized from the image's resolution (lossless FlateDecode images). */
export function pdfFile(pages: readonly EncodedPage[]): Blob {
  const encoder = new TextEncoder()
  const parts: BlobPart[] = []
  const offsets: number[] = []
  let length = 0
  const write = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part
    parts.push(bytes)
    length += bytes.length
  }
  const object = (id: number, body: string) => {
    offsets[id] = length
    write(`${id} 0 obj\n${body}\nendobj\n`)
  }

  // The comment of non-ASCII bytes marks the file as binary for transfer tools.
  write('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  const pageId = (index: number) => 3 + index * 3
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`)

  pages.forEach((page, index) => {
    const id = pageId(index)
    const width = points(page.width, page.dpiX)
    const height = points(page.height, page.dpiY)
    object(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
        `/Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`,
    )
    const content = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`
    object(id + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`)

    offsets[id + 2] = length
    write(
      `${id + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /${page.gray ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /FlateDecode ` +
        `/Length ${page.data.length} >>\nstream\n`,
    )
    write(page.data)
    write('\nendstream\nendobj\n')
  })

  const xref = length
  const count = offsets.length
  write(`xref\n0 ${count}\n0000000000 65535 f \n`)
  for (let id = 1; id < count; id++) write(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`)
  write(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return new Blob(parts, { type: 'application/pdf' })
}

/** Page length in PDF points (1/72"), from pixels at `dpi`. */
function points(pixels: number, dpi: number): number {
  return Math.round((pixels / dpi) * 72 * 100) / 100
}
