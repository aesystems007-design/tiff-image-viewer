import type { ImageRect } from './imageRect'

/** Which margin band a guide is (as seen on screen). */
export type MarginEdge = 'top' | 'bottom' | 'left' | 'right'

/**
 * A non-interactive region drawn over the page, in page pixels (unrotated page).
 * `margin` = a required blank margin band; `keep-clear` = another area that should be free of text.
 * `edge` names which margin (for warnings); keep-clear areas have none.
 */
export interface PageGuide {
  kind: 'margin' | 'keep-clear'
  edge?: MarginEdge
  rect: ImageRect
}
