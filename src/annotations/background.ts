/**
 * The two fills on an annotation. `placeBackground` is the overlay the user sees while placing it.
 * `burnBackground` is drawn into the page when the host burns annotations in. They are independent:
 * a box can be yellow on screen and transparent (or another color) in the image.
 *
 * A color is `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, or `rgb()` / `rgba()`.
 * `null`, `''`, `transparent`, or `none` is no fill. A missing or invalid value is left unset.
 */

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/** A set background: a color, or null for no fill. Undefined when the field was left out or isn't a color. */
export function annotationBackground(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text || /^(transparent|none)$/i.test(text)) return null
  if (HEX.test(text)) return text.toLowerCase()
  const match = text.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d+))?\s*\)$/i)
  if (!match) return undefined
  const channels = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (channels.some((channel) => channel > 255)) return undefined
  if (match[4] === undefined) return `rgb(${channels.join(', ')})`
  const alpha = Number(match[4])
  if (alpha > 1) return undefined
  return `rgba(${channels.join(', ')}, ${alpha})`
}

/** `placeBackground` or `burnBackground` on a host annotation object. */
export function annotationBackgroundField(
  source: object,
  key: 'placeBackground' | 'burnBackground',
): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return undefined
  return annotationBackground((source as Record<string, unknown>)[key])
}
