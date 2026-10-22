import { VERBIAGE_STAMP } from '../annotations/annotation'
import { annotationBackgroundField } from '../annotations/background'
import { annotationImageSource, sanitizeAnnotationHtml } from '../annotations/htmlContent'
import { DEFAULT_TEXT_COLOR, DEFAULT_TEXT_SIZE, type RichText, type TextAlign } from '../annotations/richText'
import type { PageInfo } from '../tiff/protocol'
import type { ImageRect } from '../viewer/imageRect'
import { requirementRectToPage } from './dpiRequirement'

/**
 * The annotation object the hosting system sends, as it did to the old viewer (booleans come as strings).
 * Positions, sizes and FontSize are pixels at the company's DPI requirement, on the page as displayed.
 */
export interface LegacyAnnotation {
  Name?: string | null
  /** Required unless `html` or `image` is set. */
  Text?: string | null
  XPos: number
  YPos: number
  Width: number
  Height: number
  /**
   * Page position in the document as shown (0 = first page).
   * Null or omitted: the page currently on screen.
   */
  PageIndex?: number | null
  AnnotationType?: string | null
  FontSize?: string | number | null
  /** Only Arial is supported; other fonts are drawn in Arial. */
  FontName?: string | null
  FontBold?: string | boolean | null
  FontUnderLine?: string | boolean | null
  /** LEFT, CENTER or RIGHT. */
  Align?: string | null
  Border?: string | boolean | null
  /** Overlay fill. A color, or `transparent` / null for none. Omitted draws no fill. */
  placeBackground?: string | null
  /** Fill drawn into the page. A color, or `transparent` / null for none. Omitted draws no fill. */
  burnBackground?: string | null
  /** Image placed in the box with the text. A data URL or an http(s) address. `Image` is accepted too. */
  image?: string | null
  Image?: string | null
  /** HTML drawn instead of the rich text. CSS and `<img>` are kept; scripts are dropped. `Html` is accepted too. */
  html?: string | null
  Html?: string | null
  /** Pre-rendered image of the stamp from the old system; not used (the text is drawn instead). */
  AnnotationFilename?: string | null
  /** `Editable` (this object) or `Uneditable`. Omitted legacy objects are Editable. */
  type?: 'Editable' | 'Uneditable' | null
}

function isTrue(value: unknown): boolean {
  return value === true || String(value).toLowerCase() === 'true'
}

/** Why the annotation can't be added, or null when it's usable. */
export function legacyAnnotationProblem(annotation: unknown): string | null {
  if (!annotation || typeof annotation !== 'object') return 'the annotation is missing'
  const a = annotation as Partial<LegacyAnnotation>
  const hasText = typeof a.Text === 'string' && a.Text.trim() !== ''
  const hasHtml = !!sanitizeAnnotationHtml(a.html ?? a.Html)
  const hasImage = !!annotationImageSource(a.image ?? a.Image)
  if (!hasText && !hasHtml && !hasImage) return 'the annotation has no Text'
  for (const key of ['XPos', 'YPos', 'Width', 'Height'] as const) {
    if (!Number.isFinite(Number(a[key]))) return `${key} is not a number`
  }
  if (a.PageIndex !== undefined && a.PageIndex !== null && !Number.isFinite(Number(a.PageIndex))) return 'PageIndex is not a number'
  if (Number(a.Width) <= 0 || Number(a.Height) <= 0) return 'Width and Height must be positive'
  return null
}

/** Display position (0-based), or null when the host left it out so the page on screen is used. */
export function legacyAnnotationPageIndex(annotation: LegacyAnnotation): number | null {
  const page = annotation.PageIndex
  if (page === undefined || page === null) return null
  return Number(page)
}

/** The name the annotation is kept under (an existing annotation with the same name is replaced). */
export function legacyAnnotationName(annotation: LegacyAnnotation): string {
  return annotation.AnnotationType || VERBIAGE_STAMP
}

/** The text as rich text: one paragraph per line, FontSize converted from requirement pixels to points. */
export function legacyAnnotationText(annotation: LegacyAnnotation, dpiRequirement: number): RichText {
  const fontPx = Number(annotation.FontSize)
  const size = Number.isFinite(fontPx) && fontPx > 0 ? Math.round(((fontPx * 72) / dpiRequirement) * 100) / 100 : DEFAULT_TEXT_SIZE
  const align = (annotation.Align ?? '').toLowerCase()
  const run = {
    bold: isTrue(annotation.FontBold),
    italic: false,
    underline: isTrue(annotation.FontUnderLine),
    color: DEFAULT_TEXT_COLOR,
    size,
  }
  return (annotation.Text || '').replace(/\r\n?/g, '\n')
    .replace(/\n+$/, '')
    .split('\n')
    .map((line) => ({
      align: (align === 'center' || align === 'right' ? align : 'left') as TextAlign,
      runs: line === '' ? [] : [{ ...run, text: line }],
    }))
}

/**
 * The box in page pixels (unrotated page). XPos / YPos / Width / Height are DPI-requirement pixels on the
 * page as displayed, scaled by page DPI / requirement and kept on the page.
 */
export function legacyAnnotationRect(annotation: LegacyAnnotation, page: PageInfo, rotation: number, dpiRequirement: number): ImageRect {
  const rect = {
    x: Number(annotation.XPos),
    y: Number(annotation.YPos),
    width: Number(annotation.Width),
    height: Number(annotation.Height),
  }
  return requirementRectToPage(rect, page, rotation, dpiRequirement)
}

export function legacyAnnotationBorder(annotation: LegacyAnnotation): boolean {
  return isTrue(annotation.Border)
}

/** Picture inserted inline at the end of the text, or null. */
export function legacyAnnotationImage(annotation: LegacyAnnotation): string | null {
  return annotationImageSource(annotation.image ?? annotation.Image)
}

/** HTML drawn instead of the rich text, or null. */
export function legacyAnnotationHtml(annotation: LegacyAnnotation): string | null {
  return sanitizeAnnotationHtml(annotation.html ?? annotation.Html)
}

/** Overlay fill and the fill drawn into the page. An omitted or invalid color is no fill. */
export function legacyAnnotationBackgrounds(annotation: LegacyAnnotation): { placeBackground: string | null; burnBackground: string | null } {
  return {
    placeBackground: annotationBackgroundField(annotation, 'placeBackground') ?? null,
    burnBackground: annotationBackgroundField(annotation, 'burnBackground') ?? null,
  }
}
