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

export type TextAlign = 'left' | 'center' | 'right'

export interface TextParagraph {
  align: TextAlign
  runs: TextRun[]
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
  return text.every((paragraph) => paragraph.runs.every((run) => run.text.trim() === ''))
}

/** Font size of a paragraph's line box (its largest run). */
export function paragraphSize(paragraph: TextParagraph): number {
  return paragraph.runs.reduce((size, run) => Math.max(size, run.size), 0) || DEFAULT_TEXT_SIZE
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
        .filter((run) => run.text !== '')
        .map((run) => {
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

function mergeRuns(runs: TextRun[]): TextRun[] {
  const merged: TextRun[] = []
  for (const run of runs) {
    const last = merged[merged.length - 1]
    if (
      last &&
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
