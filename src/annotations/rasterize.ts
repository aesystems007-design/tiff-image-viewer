/**
 * Paints an annotation's HTML into a transparent PNG at the box's page-pixel size.
 * The worker then draws that PNG. HTML is laid out in the browser (CSS and images),
 * which the worker cannot do. A snapshot of foreignObject SVG taints the canvas in Chrome, so the
 * HTML is drawn from the live element instead. Inline pictures in rich text are not snapshotted:
 * they travel with the text and the worker draws them in the line.
 */
import html2canvas from 'html2canvas'
import { sanitizeAnnotationHtml } from './htmlContent'
import { isImageRun, type RichText } from './richText'

/** PNG data URL of `html` fitted in `width` × `height` page pixels, or null when there is nothing. */
export async function rasterizeAnnotationBox(html: string | null | undefined, width: number, height: number): Promise<string | null> {
  const boxWidth = Math.max(1, Math.round(width))
  const boxHeight = Math.max(1, Math.round(height))
  const clean = sanitizeAnnotationHtml(html)
  if (!clean) return null
  return rasterizeHtml(await inlineImages(clean), boxWidth, boxHeight)
}

/**
 * Copies each inline picture into a data URL so the worker can draw it.
 * A picture that will not load is left as it was; the worker skips one it cannot decode.
 */
export async function embedRichTextImages(text: RichText): Promise<RichText> {
  const cache = new Map<string, string | null>()
  const dataUrl = async (src: string): Promise<string | null> => {
    if (src.startsWith('data:')) return src
    const cached = cache.get(src)
    if (cached !== undefined) return cached
    const data = await urlToDataUrl(src)
    cache.set(src, data)
    return data
  }
  const paragraphs: RichText = []
  for (const paragraph of text) {
    const runs = []
    for (const run of paragraph.runs) {
      if (!isImageRun(run)) {
        runs.push(run)
        continue
      }
      const image = await dataUrl(run.image)
      runs.push(image ? { ...run, image } : run)
    }
    paragraphs.push({ align: paragraph.align, runs })
  }
  return paragraphs
}

/** Rewrites `<img src>` to data URLs so the snapshot can paint them. A URL that will not load is dropped. */
async function inlineImages(html: string): Promise<string> {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  await Promise.all(
    [...doc.images].map(async (img) => {
      const src = img.getAttribute('src')
      if (!src || src.startsWith('data:')) return
      const data = await urlToDataUrl(src)
      if (data) img.setAttribute('src', data)
      else img.removeAttribute('src')
    }),
  )
  // The parser parks `<style>` on the document head.
  const styles = [...doc.head.querySelectorAll('style')].map((el) => el.outerHTML).join('')
  return styles + doc.body.innerHTML
}

async function urlToDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const blob = await response.blob()
    if (!blob.type.startsWith('image/')) return null
    return await blobToDataUrl(blob)
  } catch {
    return null
  }
}

function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(blob)
  })
}

/**
 * Lays the HTML out at `width` × `height` CSS pixels and snapshots it.
 * The node is off-screen and removed immediately. A `<style>` in it can match the viewer for that moment,
 * so the overlay keeps the real markup in a shadow root where it cannot leak.
 */
async function rasterizeHtml(html: string, width: number, height: number): Promise<string | null> {
  const box = document.createElement('div')
  box.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;overflow:hidden;box-sizing:border-box`
  box.innerHTML = html
  document.body.appendChild(box)
  try {
    await Promise.all([...box.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined)))
    const canvas = await html2canvas(box, { backgroundColor: null, scale: 1, width, height, logging: false, useCORS: true })
    return canvas.toDataURL('image/png')
  } catch {
    return null
  } finally {
    box.remove()
  }
}
