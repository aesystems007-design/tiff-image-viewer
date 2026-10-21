import type { PageOp } from '../tiff/pageOps'
import type { TiffDocument } from '../tiff/TiffDocument'

const PRINT_STYLES = `
  @page { margin: 0; }
  html, body { margin: 0; padding: 0; }
  .page {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100vw;
    height: 100vh;
    break-after: page;
  }
  .page:last-child { break-after: auto; }
  img { max-width: 100%; max-height: 100%; }
`

async function rotateImage(url: string, degrees: number): Promise<string> {
  const image = new Image()
  image.src = url
  await image.decode()

  const sideways = degrees % 180 !== 0
  const canvas = document.createElement('canvas')
  canvas.width = sideways ? image.naturalHeight : image.naturalWidth
  canvas.height = sideways ? image.naturalWidth : image.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create a 2D canvas context.')
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((degrees * Math.PI) / 180)
  ctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not prepare a rotated page for printing.')
  return URL.createObjectURL(blob)
}

/** Prints `pages` (deleted pages left out), with each page's edits and rotation applied, via a hidden iframe. */
export async function printDocument(
  doc: TiffDocument,
  pages: readonly number[],
  rotations: readonly number[],
  ops: readonly (readonly PageOp[])[],
): Promise<void> {
  const urls: string[] = []
  const temporaryUrls: string[] = []
  for (const page of pages) {
    const url = await doc.getPageUrl(page, ops[page] ?? [])
    const rotation = rotations[page] ?? 0
    if (rotation === 0) {
      urls.push(url)
    } else {
      const rotated = await rotateImage(url, rotation)
      temporaryUrls.push(rotated)
      urls.push(rotated)
    }
  }

  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
  document.body.appendChild(iframe)

  const cleanup = () => {
    iframe.remove()
    temporaryUrls.forEach((url) => URL.revokeObjectURL(url))
  }

  try {
    const frameDoc = iframe.contentDocument
    const frameWindow = iframe.contentWindow
    if (!frameDoc || !frameWindow) throw new Error('Could not open the print view.')

    const style = frameDoc.createElement('style')
    style.textContent = PRINT_STYLES
    frameDoc.head.appendChild(style)
    frameDoc.title = doc.name

    const images = urls.map((url) => {
      const page = frameDoc.createElement('div')
      page.className = 'page'
      const img = frameDoc.createElement('img')
      img.src = url
      page.appendChild(img)
      frameDoc.body.appendChild(page)
      return img
    })
    await Promise.all(images.map((img) => img.decode()))

    frameWindow.addEventListener('afterprint', cleanup, { once: true })
    frameWindow.focus()
    frameWindow.print()
  } catch (err) {
    cleanup()
    throw err
  }
}
