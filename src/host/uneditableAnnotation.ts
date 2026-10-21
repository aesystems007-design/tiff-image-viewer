import { DEFAULT_TEXT_COLOR, DEFAULT_TEXT_SIZE, type RichText, type TextAlign } from '../annotations/richText'
import type { TextOp } from '../tiff/pageOps'
import type { ImageRect } from '../viewer/imageRect'

/** `type` the host sets on an annotation. Editable can be changed on screen; Uneditable can only be moved. */
export type AnnotationKind = 'Editable' | 'Uneditable'

/** `stampType` a host sends for an annotation that can be placed but not edited. `FillInStamp` is the old name. */
export const UNEDITABLE_ANNOTATION = 'UneditableAnnotation'
const LEGACY_STAMP_TYPE = 'FillInStamp'

/**
 * An uneditable annotation as the host sends it (`type: 'Uneditable'`, or the older `stampType`): a box the
 * user can move, and nothing else. `left` / `top` / `width` / `height` and `fontSize` are pixels at the DPI
 * requirement on the page as displayed. It stays an overlay until the host burns annotations in.
 */
export interface UneditableAnnotation {
  type?: AnnotationKind
  stampType?: typeof UNEDITABLE_ANNOTATION | typeof LEGACY_STAMP_TYPE
  left: number
  top: number
  width: number
  height: number
  /** Position in the document as shown (0 = first page); the first page when missing. */
  pageIndex?: number
  /** Shown in the box; `Text` (legacy annotation name) is accepted too. */
  text?: string
  fontFamily?: string
  fontSize?: number
  fontStyle?: string
  fontWeight?: string
  fontColor?: string
  underlineVisible?: boolean
  linethrough?: boolean
  /** LEFT, CENTER or RIGHT. */
  textAlign?: string
  /** top, middle / center or bottom. */
  alignItem?: string
  /** 0-100. */
  opacity?: number
  isFill?: boolean
  fillColor?: string
  isStroke?: boolean
  strokeColor?: string
  strokeWidth?: number
  dashType?: string
  [key: string]: unknown
}

export function isUneditableAnnotation(value: unknown): value is UneditableAnnotation {
  if (!value || typeof value !== 'object') return false
  const stampType = (value as { stampType?: unknown }).stampType
  return stampType === UNEDITABLE_ANNOTATION || stampType === LEGACY_STAMP_TYPE
}

/**
 * Which kind of annotation the host sent.
 * `type` wins. Without it, the old `stampType` means Uneditable and anything else is Editable.
 * `'invalid'` is a `type` that isn't either name.
 */
export function annotationKind(value: unknown): AnnotationKind | 'invalid' | null {
  if (!value || typeof value !== 'object') return null
  const type = (value as { type?: unknown }).type
  if (type === 'Editable' || type === 'Uneditable') return type
  if (type !== undefined && type !== null && type !== '') return 'invalid'
  return isUneditableAnnotation(value) ? 'Uneditable' : 'Editable'
}

/** Why the annotation can't be placed, or null when it's usable. */
export function uneditableAnnotationProblem(annotation: UneditableAnnotation): string | null {
  for (const key of ['left', 'top', 'width', 'height'] as const) {
    if (!Number.isFinite(Number(annotation[key]))) return `${key} is not a number`
  }
  if (Number(annotation.width) <= 0 || Number(annotation.height) <= 0) return 'width and height must be positive'
  const page = annotation.pageIndex ?? annotation.PageIndex
  if (page !== undefined && page !== null && !Number.isInteger(Number(page))) return 'pageIndex is not a number'
  return null
}

/** Page position (display order) the annotation goes on. */
export function uneditableAnnotationPageIndex(annotation: UneditableAnnotation): number {
  const page = annotation.pageIndex ?? annotation.PageIndex
  return page === undefined || page === null ? 0 : Number(page)
}

/** The text shown in the box (`\n` = new line). */
export function uneditableAnnotationText(annotation: UneditableAnnotation): string {
  const text = annotation.text ?? annotation.Text
  return text === undefined || text === null ? '' : String(text)
}

/** Its box in DPI-requirement pixels on the displayed page. */
export function uneditableAnnotationRect(annotation: UneditableAnnotation): ImageRect {
  return { x: Number(annotation.left), y: Number(annotation.top), width: Number(annotation.width), height: Number(annotation.height) }
}

const ALIGN: Record<string, TextAlign> = { left: 'left', center: 'center', right: 'right' }
const VALIGN: Record<string, 'top' | 'middle' | 'bottom'> = { top: 'top', middle: 'middle', center: 'middle', bottom: 'bottom' }
const DASH: Record<string, 'solid' | 'dashed' | 'dotted'> = {
  solid: 'solid',
  dash: 'dashed',
  dashed: 'dashed',
  dot: 'dotted',
  dotted: 'dotted',
}

/**
 * The op that draws this annotation into its page the way the overlay shows it.
 * `pagePxPerRequirement` is page pixels per DPI-requirement pixel on the displayed page (the overlay's scale).
 */
export function uneditableAnnotationOp(
  annotation: UneditableAnnotation,
  rect: ImageRect,
  rotation: number,
  pxPerPt: number,
  pagePxPerRequirement: number,
): TextOp {
  const fontPx = Number(annotation.fontSize)
  const fontPagePx = (Number.isFinite(fontPx) && fontPx > 0 ? fontPx : 41.67) * pagePxPerRequirement
  const size = pxPerPt > 0 ? Math.round((fontPagePx / pxPerPt) * 100) / 100 : DEFAULT_TEXT_SIZE
  const align = ALIGN[(annotation.textAlign || 'left').toLowerCase()] ?? 'left'
  const run = {
    bold: String(annotation.fontWeight).toLowerCase() === 'bold',
    italic: String(annotation.fontStyle).toLowerCase() === 'italic',
    underline: !!annotation.underlineVisible,
    color: annotation.fontColor || DEFAULT_TEXT_COLOR,
    size: size > 0 ? size : DEFAULT_TEXT_SIZE,
  }
  const lines = uneditableAnnotationText(annotation).replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n')
  const text: RichText = (lines.length ? lines : ['']).map((line) => ({
    align,
    runs: line === '' ? [] : [{ ...run, text: line }],
  }))
  const opacity = Number(annotation.opacity)
  const valign = VALIGN[(annotation.alignItem || 'top').toLowerCase()] ?? 'top'
  const strokeWidth = Math.max(1, (Number(annotation.strokeWidth) || 1) * pagePxPerRequirement)
  return {
    type: 'text',
    rect: { ...rect },
    rotation,
    pxPerPt,
    text,
    ...(annotation.isFill ? { fill: annotation.fillColor || '#ffff00' } : {}),
    ...(Number.isFinite(opacity) ? { opacity: Math.min(Math.max(opacity, 0), 100) / 100 } : {}),
    ...(valign !== 'top' ? { valign } : {}),
    ...(annotation.isStroke
      ? {
          stroke: {
            color: annotation.strokeColor || '#000000',
            width: strokeWidth,
            dash: DASH[(annotation.dashType || 'solid').toLowerCase()] ?? 'solid',
          },
        }
      : {}),
  }
}

/** The annotation as sent, moved to `left` / `top` (requirement pixels on the page displayed at position `pageIndex`). */
export function placedUneditableAnnotation(
  annotation: UneditableAnnotation,
  left: number,
  top: number,
  pageIndex: number,
): UneditableAnnotation {
  return { ...annotation, left, top, pageIndex }
}

const DASHES: Record<string, string> = { solid: 'solid', dash: 'dashed', dashed: 'dashed', dot: 'dotted', dotted: 'dotted' }
const ALIGN_ITEMS: Record<string, string> = { top: 'flex-start', middle: 'center', center: 'center', bottom: 'flex-end' }

/** CSS for the box and its text on screen; `scale` = screen pixels per requirement pixel. */
export function uneditableAnnotationStyle(annotation: UneditableAnnotation, scale: number): Record<string, string> {
  const opacity = Number.isFinite(Number(annotation.opacity)) ? Math.min(Math.max(Number(annotation.opacity), 0), 100) / 100 : 1
  const decorations = [annotation.underlineVisible ? 'underline' : '', annotation.linethrough ? 'line-through' : ''].filter(Boolean)
  const style: Record<string, string> = {
    opacity: String(opacity),
    fontFamily: `${annotation.fontFamily || 'Arial'}, Helvetica, sans-serif`,
    fontSize: `${(Number(annotation.fontSize) || 41.67) * scale}px`,
    fontWeight: String(annotation.fontWeight).toLowerCase() === 'bold' ? 'bold' : 'normal',
    fontStyle: String(annotation.fontStyle).toLowerCase() === 'italic' ? 'italic' : 'normal',
    color: annotation.fontColor || '#000000',
    textAlign: (annotation.textAlign || 'left').toLowerCase(),
    textDecoration: decorations.join(' ') || 'none',
    justifyContent: ALIGN_ITEMS[(annotation.alignItem || 'top').toLowerCase()] ?? 'flex-start',
    background: annotation.isFill ? annotation.fillColor || '#ffff00' : 'transparent',
  }
  if (annotation.isStroke) {
    const width = Math.max(1, (Number(annotation.strokeWidth) || 1) * scale)
    style.border = `${width}px ${DASHES[(annotation.dashType || 'solid').toLowerCase()] ?? 'solid'} ${annotation.strokeColor || '#000000'}`
  }
  return style
}
