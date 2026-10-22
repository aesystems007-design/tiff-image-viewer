import type { TextOp } from '../tiff/pageOps'
import type { ImageRect } from '../viewer/imageRect'
import type { RichText } from './richText'

/**
 * An editable text box the host added. It stays apart from the page image until the host burns annotations in.
 * `rect` is in page pixels (unrotated page, like ops); the text is shown upright on screen at any rotation.
 * Its height is a minimum: the box grows down (on screen) to fit the text.
 */
export interface Annotation {
  id: number
  page: number
  rect: ImageRect
  /** Paragraphs of styled text. A run may be a picture inline with the words. */
  text: RichText
  /**
   * Sanitized HTML drawn instead of the rich text (CSS and `<img>` kept).
   * Null means the box is the rich text.
   */
  html: string | null
  /** Set for annotations the host adds (e.g. `VerbiageStamp`); adding another with the same name replaces it. */
  name?: string
  /** Frame around the box (see BORDER_WIDTH_PT / BORDER_COLOR), drawn in when the host burns it. */
  border?: boolean
  /** Overlay fill while the box is being placed. Null draws no fill. */
  placeBackground: string | null
  /** Fill drawn into the page on burn. Null leaves the page underneath. */
  burnBackground: string | null
  /** The `requestId` from the host command that added it, echoed when it is burned in. */
  requestId?: string | number | null
}

/** Name of the stamp the host adds with the legacy AddAnnotation call. */
export const VERBIAGE_STAMP = 'VerbiageStamp'

/** Default box size on screen, in inches. */
export const ANNOTATION_WIDTH_INCHES = 3
export const ANNOTATION_HEIGHT_INCHES = 0.5

/** The op that draws `annotation` into its page, upright for the page's current rotation. Used when the host burns it in. */
export function annotationOp(annotation: Annotation, rotation: number, pxPerPt: number, picture?: string | null): TextOp {
  return {
    type: 'text',
    rect: { ...annotation.rect },
    rotation,
    pxPerPt,
    text: annotation.html ? [] : JSON.parse(JSON.stringify(annotation.text)),
    ...(annotation.border ? { border: true } : {}),
    ...(annotation.burnBackground ? { fill: annotation.burnBackground } : {}),
    ...(picture ? { picture } : {}),
  }
}
