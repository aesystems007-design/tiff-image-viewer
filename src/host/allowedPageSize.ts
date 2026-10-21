import { PAPER_SIZES, pageResolution, type PaperSize } from '../tiff/pageOps'
import type { PageInfo } from '../tiff/protocol'

/**
 * Paper size the host allows for this document. `ANY` does not warn.
 * `LETTERLEGAL` allows either Letter (8.5" × 11") or Legal (8.5" × 14").
 */
export type AllowedPageSize = 'LETTER' | 'LEGAL' | 'LETTERLEGAL' | 'ANY'

/**
 * How far a page may sit from the allowed paper size, in inches.
 * `minus` is under the paper size, `plus` is over it. `0.1` and `0.1` is the "-.1/+.1" case.
 */
export interface PageSizeThreshold {
  minus: number
  plus: number
}

/** Allowed size plus its threshold. `ANY` draws no page-size warning. */
export interface AllowedPageSizeRule {
  size: AllowedPageSize
  threshold: PageSizeThreshold
}

export const ANY_PAGE_SIZE: AllowedPageSizeRule = { size: 'ANY', threshold: { minus: 0, plus: 0 } }

const PAPER: Record<Exclude<AllowedPageSize, 'ANY'>, readonly PaperSize[]> = {
  LETTER: ['letter'],
  LEGAL: ['legal'],
  LETTERLEGAL: ['letter', 'legal'],
}

/** "Letter", "Legal", or "(Letter or Legal)" — the phrase in the page warning. */
export function allowedPageSizeLabel(size: AllowedPageSize): string {
  switch (size) {
    case 'LETTER':
      return 'Letter'
    case 'LEGAL':
      return 'Legal'
    case 'LETTERLEGAL':
      return '(Letter or Legal)'
    default:
      return ''
  }
}

/** Detail for `warningMessage`: "Page N is not within the allowed page size of Letter". */
export function pageSizeWarningDetail(size: Exclude<AllowedPageSize, 'ANY'>): string {
  return `is not within the allowed page size of ${allowedPageSizeLabel(size)}`
}

/** `LETTER` / `LEGAL` / `LETTERLEGAL` / `ANY`. Anything else, including a missing value, is `ANY`. */
export function parseAllowedPageSize(value: unknown): AllowedPageSize {
  if (typeof value !== 'string') return 'ANY'
  const text = value.trim().toUpperCase().replace(/[\s_-]/g, '')
  if (text === 'LETTER' || text === 'LEGAL' || text === 'LETTERLEGAL' || text === 'ANY') return text
  return 'ANY'
}

/**
 * Threshold in inches. A number (or numeric string) is the same distance under and over: `0.1` means ±0.1".
 * A pair `-.1/+.1` sets the two sides separately (the value before `/` is under, the value after is over).
 * A missing or unreadable value is no slack (exact paper size, aside from half a pixel of rounding).
 */
export function parsePageSizeThreshold(value: unknown): PageSizeThreshold {
  if (typeof value === 'number' && Number.isFinite(value)) return symmetric(value)
  if (typeof value === 'string') {
    const text = value.trim()
    const pair = text.match(/^([+-]?(?:\d+\.?\d*|\.\d+))\s*\/\s*([+-]?(?:\d+\.?\d*|\.\d+))$/)
    if (pair) {
      const minus = Math.abs(Number(pair[1]))
      const plus = Math.abs(Number(pair[2]))
      if (Number.isFinite(minus) && Number.isFinite(plus)) return { minus, plus }
    }
    const inches = Number(text)
    if (Number.isFinite(inches)) return symmetric(inches)
  }
  return { minus: 0, plus: 0 }
}

function symmetric(inches: number): PageSizeThreshold {
  const slack = Math.abs(inches)
  return { minus: slack, plus: slack }
}

/** Host fields `allowedPageSize` and `threshold` (on `open-image` or `set-allowed-page-size`). */
export function allowedPageSizeFromHost(size: unknown, threshold: unknown): AllowedPageSizeRule {
  return { size: parseAllowedPageSize(size), threshold: parsePageSizeThreshold(threshold) }
}

/**
 * True when the page's inch size (from its resolution, after a paper-size conversion) is within the
 * threshold of an allowed size. Landscape counts: 11" × 8.5" is Letter. `ANY` always matches.
 */
export function pageMatchesAllowedSize(page: PageInfo, rule: AllowedPageSizeRule): boolean {
  if (rule.size === 'ANY') return true
  const { dpiX, dpiY } = pageResolution(page)
  if (!(dpiX > 0) || !(dpiY > 0) || !(page.width > 0) || !(page.height > 0)) return false
  const widthIn = page.width / dpiX
  const heightIn = page.height / dpiY
  return PAPER[rule.size].some((name) => fitsPaper(widthIn, heightIn, dpiX, dpiY, PAPER_SIZES[name], rule.threshold))
}

function fitsPaper(
  widthIn: number,
  heightIn: number,
  dpiX: number,
  dpiY: number,
  paper: { width: number; height: number },
  threshold: PageSizeThreshold,
): boolean {
  return (
    fits(widthIn, heightIn, dpiX, dpiY, paper.width, paper.height, threshold) ||
    fits(widthIn, heightIn, dpiX, dpiY, paper.height, paper.width, threshold)
  )
}

function fits(
  widthIn: number,
  heightIn: number,
  dpiX: number,
  dpiY: number,
  paperWidth: number,
  paperHeight: number,
  threshold: PageSizeThreshold,
): boolean {
  return sideWithin(widthIn, paperWidth, dpiX, threshold) && sideWithin(heightIn, paperHeight, dpiY, threshold)
}

/** Half a pixel, so a page rounded onto the paper size is not warned when the threshold is 0. */
function sideWithin(actual: number, target: number, dpi: number, threshold: PageSizeThreshold): boolean {
  const slack = 0.5 / dpi
  return actual >= target - threshold.minus - slack && actual <= target + threshold.plus + slack
}
