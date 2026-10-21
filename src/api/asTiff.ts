import { convertPdfToTiff } from './pdfToTiff'

export type FileKind = 'tiff' | 'pdf'

/** Tells TIFFs and PDFs apart by their first bytes (names and MIME types can't be trusted). */
export async function fileKind(file: Blob): Promise<FileKind | null> {
  const [a, b, c, d, e] = new Uint8Array(await file.slice(0, 5).arrayBuffer())
  if ((a === 0x49 && b === 0x49 && c === 42 && d === 0) || (a === 0x4d && b === 0x4d && c === 0 && d === 42)) return 'tiff'
  if (String.fromCharCode(a, b, c, d, e) === '%PDF-') return 'pdf'
  return null
}

/**
 * The viewer only works on TIFFs: returns `file` as is when it's a TIFF, converts a PDF with the conversion
 * API (calling `onConvert` first, e.g. to show progress) and rejects anything else.
 */
export async function asTiff(file: File, onConvert?: () => void): Promise<File> {
  const kind = await fileKind(file)
  if (kind === 'tiff') return file
  if (kind !== 'pdf') throw new Error('Only TIFF and PDF files are supported.')
  onConvert?.()
  const tiff = await convertPdfToTiff(file, file.name)
  return new File([tiff], file.name.replace(/\.pdf$/i, '') + '.tif', { type: 'image/tiff' })
}
