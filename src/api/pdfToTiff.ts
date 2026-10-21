import { encodePage } from '../export/encodedPage'
import { tiffFile } from '../export/tiffFile'

const STAND_IN_DPI = 200

/**
 * Converts a PDF to a multi-page TIFF on the server. Stand-in until the real conversion API is wired up:
 * returns one blank Letter page per PDF page (pages counted roughly from the PDF), each labelled with the
 * file name and page number, so opening and inserting PDFs can be tried end to end.
 */
export async function convertPdfToTiff(pdf: Blob, fileName: string): Promise<Blob> {
  const pageCount = countPdfPages(await pdf.text())
  const pages = []
  for (let page = 1; page <= pageCount; page++) {
    pages.push(await encodePage(placeholderPage(fileName, page, pageCount), STAND_IN_DPI, STAND_IN_DPI))
  }
  return tiffFile(pages)
}

/** Page objects in the PDF; at least 1 (pages inside compressed object streams aren't found). */
function countPdfPages(text: string): number {
  return Math.max(1, text.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0)
}

function placeholderPage(fileName: string, page: number, pageCount: number): ImageData {
  const width = 8.5 * STAND_IN_DPI
  const height = 11 * STAND_IN_DPI
  const context = new OffscreenCanvas(width, height).getContext('2d')!
  context.fillStyle = '#fff'
  context.fillRect(0, 0, width, height)
  context.strokeStyle = '#000'
  context.lineWidth = 6
  context.strokeRect(STAND_IN_DPI / 2, STAND_IN_DPI / 2, width - STAND_IN_DPI, height - STAND_IN_DPI)
  context.fillStyle = '#000'
  context.textAlign = 'center'
  context.font = 'bold 72px Arial'
  context.fillText('PDF converted by the stand-in', width / 2, height / 2 - 120)
  context.font = '56px Arial'
  context.fillText(fileName, width / 2, height / 2)
  context.fillText(`Page ${page} of ${pageCount}`, width / 2, height / 2 + 100)
  return context.getImageData(0, 0, width, height)
}
