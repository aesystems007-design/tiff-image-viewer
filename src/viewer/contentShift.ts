import { pageResolution, type PageOp } from '../tiff/pageOps'
import type { PageInfo } from '../tiff/protocol'
import { unrotateDelta } from './imageRect'

/** A content move as seen on screen, in inches (positive = right / down). */
export interface ScreenInches {
  x: number
  y: number
}

/** A content move in page pixels (unrotated page). */
export interface PageShift {
  dx: number
  dy: number
}

/** How far a page's content has been moved: the sum of its shift ops. */
export function totalShift(ops: readonly PageOp[]): PageShift {
  let dx = 0
  let dy = 0
  for (const op of ops) {
    if (op.type !== 'shift') continue
    dx += op.dx
    dy += op.dy
  }
  return { dx, dy }
}

/** A move in page pixels as seen on the page displayed at `rotation`, in inches. */
export function shiftToScreenInches({ dx, dy }: PageShift, page: PageInfo, rotation: number): ScreenInches {
  const { dpiX, dpiY } = pageResolution(page)
  const screen = unrotateDelta(dx / dpiX, dy / dpiY, -rotation)
  return { x: screen.dx, y: screen.dy }
}

/** The move in page pixels that moves the content of a page displayed at `rotation` by `inches` on screen. */
export function screenInchesToShift(inches: ScreenInches, page: PageInfo, rotation: number): PageShift {
  const { dpiX, dpiY } = pageResolution(page)
  const sideways = ((rotation % 360) + 360) % 180 !== 0
  const { dx, dy } = unrotateDelta(inches.x * (sideways ? dpiY : dpiX), inches.y * (sideways ? dpiX : dpiY), rotation)
  return { dx: Math.round(dx), dy: Math.round(dy) }
}

/** E.g. `1.14" right, 0.50" down`; empty when the move rounds to nothing. */
export function describeMove({ x, y }: ScreenInches): string {
  const part = (value: number, positive: string, negative: string) =>
    Math.abs(value) < 0.005 ? '' : `${Math.abs(value).toFixed(2)}" ${value > 0 ? positive : negative}`
  return [part(x, 'right', 'left'), part(y, 'down', 'up')].filter(Boolean).join(', ')
}
