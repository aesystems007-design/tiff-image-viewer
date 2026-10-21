/**
 * How the page is fitted into the viewer: `page` = Best Fit (whole page visible), `width` = Fit Width
 * (page width fills the viewer), `actual` = Full Size (100%).
 */
export type FitMode = 'page' | 'width' | 'actual'

/** Fit on start, and for a newly opened page after a manual zoom cleared the fit mode. */
export const DEFAULT_FIT_MODE: FitMode = 'width'
