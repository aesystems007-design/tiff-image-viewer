import { annotationImageSource } from './htmlContent'

/** A piece of text with one style. Sizes are in points (1/72"). */
export interface TextRun {
  text: string
  bold: boolean
  italic: boolean
  underline: boolean
  /** CSS hex color, e.g. `#000000`. */
  color: string
  size: number
}

/** A picture sitting in the line with the text. Width and height are points, so it scales with the page. */
export interface ImageRun {
  image: string
  width: number
  height: number
}

/** One item in a line: styled text, or a picture. */
export type Run = TextRun | ImageRun

export function isImageRun(run: Run): run is ImageRun {
  return 'image' in run
}

/** Longest side of an inline picture, in points (2 inches). Larger pictures scale down, keeping their shape. */
export const INLINE_IMAGE_MAX_PT = 144

export type TextAlign = 'left' | 'center' | 'right'

export interface TextParagraph {
  align: TextAlign
  runs: Run[]
}

/** Rich text as edited in the annotation popup and drawn on the page. Plain data, so it can go to the worker. */
export type RichText = TextParagraph[]

export const FONT_FAMILY = 'Arial, Helvetica, sans-serif'
export const LINE_HEIGHT = 1.2
export const DEFAULT_TEXT_SIZE = 12
export const DEFAULT_TEXT_COLOR = '#000000'
export const TEXT_SIZES = [8, 10, 12, 14, 18, 24, 36, 48, 72]
/** Annotation border: 1/100", black at 75% opacity (as the legacy viewer's stamp border). */
export const BORDER_WIDTH_PT = 0.72
export const BORDER_COLOR = 'rgba(0, 0, 0, 0.75)'

export function isEmptyText(text: RichText): boolean {
  return text.every((paragraph) => paragraph.runs.every((run) => (isImageRun(run) ? false : run.text.trim() === '')))
}

/** Font size of a paragraph's line box (its largest text run). */
export function paragraphSize(paragraph: TextParagraph): number {
  return paragraph.runs.reduce((size, run) => (isImageRun(run) ? size : Math.max(size, run.size)), 0) || DEFAULT_TEXT_SIZE
}

/** Point size for a picture of `naturalWidth` × `naturalHeight` CSS pixels, capped at `INLINE_IMAGE_MAX_PT`. */
export function inlineImageBox(naturalWidth: number, naturalHeight: number): { width: number; height: number } {
  const widthPx = naturalWidth > 0 ? naturalWidth : 96
  const heightPx = naturalHeight > 0 ? naturalHeight : 96
  let width = widthPx * 0.75
  let height = heightPx * 0.75
  const longest = Math.max(width, height)
  if (longest > INLINE_IMAGE_MAX_PT) {
    width *= INLINE_IMAGE_MAX_PT / longest
    height *= INLINE_IMAGE_MAX_PT / longest
  }
  const round = (value: number) => Math.round(Math.max(8, value) * 100) / 100
  return { width: round(width), height: round(height) }
}

/** Reads a picture's pixel size and returns an inline run, or null when it cannot be loaded. */
export function loadInlineImage(src: string): Promise<ImageRun | null> {
  const image = annotationImageSource(src)
  if (!image) return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ image, ...inlineImageBox(img.naturalWidth, img.naturalHeight) })
    img.onerror = () => resolve(null)
    img.src = image
  })
}

/** The same text with `image` at the end of the last line, after a space when the line ends on a word. */
export function textWithInlineImage(text: RichText, image: ImageRun): RichText {
  const paragraphs: RichText = text.length
    ? text.map((paragraph) => ({ align: paragraph.align, runs: [...paragraph.runs] }))
    : [{ align: 'left', runs: [] }]
  const last = paragraphs[paragraphs.length - 1]
  const tail = last.runs[last.runs.length - 1]
  if (tail && !isImageRun(tail) && tail.text !== '' && !/\s$/.test(tail.text)) last.runs.push({ ...tail, text: ' ' })
  last.runs.push(image)
  return paragraphs
}

/** CSS for a run; `pxPerPt` converts point sizes to CSS pixels. */
export function runStyle(run: TextRun, pxPerPt: number): Record<string, string> {
  return {
    fontSize: `${run.size * pxPerPt}px`,
    fontWeight: run.bold ? '700' : '400',
    fontStyle: run.italic ? 'italic' : 'normal',
    textDecoration: run.underline ? 'underline' : 'none',
    color: run.color,
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** HTML for the rich text editor (sizes in pt so the editor shows them at their nominal size). */
export function richTextToHtml(text: RichText): string {
  return text
    .map((paragraph) => {
      const runs = paragraph.runs
        .map((run) => {
          if (isImageRun(run)) {
            const src = annotationImageSource(run.image)
            if (!src) return ''
            return `<img src="${escapeHtml(src)}" alt="" draggable="false" data-width="${run.width}" data-height="${run.height}" style="width: ${run.width}pt; height: ${run.height}pt; vertical-align: middle" />`
          }
          if (run.text === '') return ''
          const style = Object.entries({ ...runStyle(run, 1), fontSize: `${run.size}pt` })
            .map(([key, value]) => `${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${value}`)
            .join('; ')
          return `<span style="${escapeHtml(style)}">${escapeHtml(run.text)}</span>`
        })
        .join('')
      return `<div style="text-align: ${paragraph.align}">${runs || '<br>'}</div>`
    })
    .join('')
}

const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE'])

function toHex(cssColor: string): string {
  const match = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!match) return DEFAULT_TEXT_COLOR
  return `#${match.slice(1, 4).map((c) => Number(c).toString(16).padStart(2, '0')).join('')}`
}

function alignOf(element: Element): TextAlign {
  const align = getComputedStyle(element).textAlign
  if (align === 'center') return 'center'
  return align === 'right' || align === 'end' ? 'right' : 'left'
}

/**
 * Reads the editor's content into rich text, using computed styles so it doesn't matter which markup the
 * browser produced (b / span style / font). `root` must be attached to the document.
 */
export function richTextFromElement(root: HTMLElement): RichText {
  const paragraphs: TextParagraph[] = []
  let current: TextParagraph | null = null
  const start = (element: Element) => {
    current = { align: alignOf(element), runs: [] }
    paragraphs.push(current)
    return current
  }

  const underlined = (element: Element | null) => {
    for (let el = element; el && el !== root.parentElement; el = el.parentElement) {
      if (getComputedStyle(el).textDecorationLine.includes('underline')) return true
    }
    return false
  }

  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = (child.textContent ?? '').replace(/\u00a0/g, ' ').replace(/[\r\n]+/g, ' ').replace(/\u200b/g, '')
        const parent = child.parentElement ?? root
        if (text === '') continue
        const style = getComputedStyle(parent)
        const paragraph: TextParagraph = current ?? start(parent)
        paragraph.runs.push({
          text,
          bold: Number.parseInt(style.fontWeight, 10) >= 600,
          italic: style.fontStyle === 'italic' || style.fontStyle.startsWith('oblique'),
          underline: underlined(parent),
          color: toHex(style.color),
          size: Math.round(Number.parseFloat(style.fontSize) * 0.75 * 2) / 2 || DEFAULT_TEXT_SIZE,
        })
      } else if (child instanceof HTMLImageElement) {
        const src = annotationImageSource(child.getAttribute('src'))
        if (!src) continue
        const width = Number(child.dataset.width)
        const height = Number(child.dataset.height)
        const paragraph: TextParagraph = current ?? start(child.parentElement ?? root)
        paragraph.runs.push({
          image: src,
          width: Number.isFinite(width) && width > 0 ? width : INLINE_IMAGE_MAX_PT,
          height: Number.isFinite(height) && height > 0 ? height : INLINE_IMAGE_MAX_PT,
        })
      } else if (child instanceof HTMLBRElement) {
        if (!current) start(child.parentElement ?? root)
        current = null
      } else if (child instanceof HTMLElement) {
        const block = BLOCK_TAGS.has(child.tagName)
        if (block) current = null
        walk(child)
        if (block) current = null
      }
    }
  }
  walk(root)

  for (const paragraph of paragraphs) paragraph.runs = mergeRuns(paragraph.runs)
  while (paragraphs.length > 0 && paragraphs[paragraphs.length - 1].runs.length === 0) paragraphs.pop()
  return paragraphs
}

function mergeRuns(runs: Run[]): Run[] {
  const merged: Run[] = []
  for (const run of runs) {
    const last = merged[merged.length - 1]
    if (
      last &&
      !isImageRun(last) &&
      !isImageRun(run) &&
      last.bold === run.bold &&
      last.italic === run.italic &&
      last.underline === run.underline &&
      last.color === run.color &&
      last.size === run.size
    ) {
      last.text += run.text
    } else {
      merged.push({ ...run })
    }
  }
  return merged
}
