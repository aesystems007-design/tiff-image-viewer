/** A rectangle in page pixel coordinates (unrotated page, origin top-left). */
export interface ImageRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Maps a rect on the page displayed with a clockwise `rotation` back to the unrotated page
 * (`width` x `height` pixels).
 */
export function unrotateRect(rect: ImageRect, rotation: number, width: number, height: number): ImageRect {
  const toPage = (x: number, y: number): [number, number] => {
    switch (((rotation % 360) + 360) % 360) {
      case 90:
        return [y, height - x]
      case 180:
        return [width - x, height - y]
      case 270:
        return [width - y, x]
      default:
        return [x, y]
    }
  }
  const [ax, ay] = toPage(rect.x, rect.y)
  const [bx, by] = toPage(rect.x + rect.width, rect.y + rect.height)
  return { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) }
}

/**
 * Maps a rect on the unrotated page (`width` x `height` pixels) to the page displayed with a clockwise
 * `rotation` (the inverse of unrotateRect).
 */
export function rotateRect(rect: ImageRect, rotation: number, width: number, height: number): ImageRect {
  const sideways = ((rotation % 360) + 360) % 180 !== 0
  return unrotateRect(rect, -rotation, sideways ? height : width, sideways ? width : height)
}

/** Maps a movement on the page displayed with a clockwise `rotation` back to the unrotated page. */
export function unrotateDelta(dx: number, dy: number, rotation: number): { dx: number; dy: number } {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { dx: dy, dy: -dx }
    case 180:
      return { dx: -dx, dy: -dy }
    case 270:
      return { dx: -dy, dy: dx }
    default:
      return { dx, dy }
  }
}
