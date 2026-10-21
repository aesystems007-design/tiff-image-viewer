import type { MarginEdge } from '../viewer/pageGuide'

/**
 * An image warning the viewer found (e.g. content in a margin). Shown in the warnings bar; clicking one
 * takes the user to that page.
 */
export interface ImageWarning {
  id: string
  /** File page index. */
  page: number
  /** 1-based position in the display order, for the message. */
  pageNumber: number
  /** Short message, e.g. "overlaps the top margin". */
  detail: string
}

/** User-facing detail for a hit in a margin band or keep-clear box. */
export function warningDetail(kind: 'margin' | 'keep-clear', edge?: MarginEdge): string {
  if (kind === 'keep-clear') return 'has content in a keep-clear area'
  switch (edge) {
    case 'top':
      return 'overlaps the top margin'
    case 'bottom':
      return 'overlaps the bottom margin'
    case 'left':
      return 'overlaps the left margin'
    case 'right':
      return 'overlaps the right margin'
    default:
      return 'overlaps a margin'
  }
}

export function warningMessage(warning: ImageWarning): string {
  return `Page ${warning.pageNumber} ${warning.detail}`
}
