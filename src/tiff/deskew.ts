import type { Pixels } from './pageOps'

/** Largest skew looked for, in degrees either way; scans are rarely off by more. */
export const MAX_SKEW_DEGREES = 10
/** Skew smaller than this is left alone (well under a pixel across a line of text at scan resolution). */
export const MIN_SKEW_DEGREES = 0.05

/** Dark pixels sampled at most; more only slows detection down. */
const MAX_POINTS = 200_000
/** Fewer dark pixels than this (a nearly blank page) isn't enough to measure a skew. */
const MIN_POINTS = 200
/** The skewed profile must beat the straight one by this factor; content without lines (photos) gains little. */
const MIN_GAIN = 1.02

/**
 * Skew of the page content in degrees, clockwise positive (lines of text descend to the right), or 0
 * when it can't be measured. Projection profile method: dark pixels are projected onto the line normal
 * at each candidate angle, and lines of text are sharpest (the profile is peakiest) at the true skew.
 */
export function detectSkew({ data, width, height }: Pixels): number {
  const dark: number[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 128) dark.push(x, y)
    }
  }
  const total = dark.length / 2
  if (total < MIN_POINTS) return 0
  const stride = Math.ceil(total / MAX_POINTS)
  const count = Math.floor(total / stride)
  const xs = new Float64Array(count)
  const ys = new Float64Array(count)
  for (let k = 0; k < count; k++) {
    xs[k] = dark[k * stride * 2] - width / 2
    ys[k] = dark[k * stride * 2 + 1] - height / 2
  }

  const offset = Math.ceil(Math.hypot(width, height) / 2) + 1
  const bins = new Float64Array(offset * 2 + 1)
  const score = (degrees: number) => {
    const radians = (degrees * Math.PI) / 180
    const sin = Math.sin(radians)
    const cos = Math.cos(radians)
    bins.fill(0)
    for (let k = 0; k < count; k++) bins[Math.round(ys[k] * cos - xs[k] * sin) + offset]++
    let sum = 0
    for (let b = 0; b < bins.length; b++) sum += bins[b] * bins[b]
    return sum
  }

  const best = (from: number, to: number, step: number) => {
    let angle = 0
    let top = -1
    for (let degrees = from; degrees <= to + step / 2; degrees += step) {
      const value = score(degrees)
      if (value > top) {
        top = value
        angle = degrees
      }
    }
    return angle
  }

  const coarse = best(-MAX_SKEW_DEGREES, MAX_SKEW_DEGREES, 0.5)
  const fine = best(coarse - 0.5, coarse + 0.5, 0.05)
  if (Math.abs(fine) < MIN_SKEW_DEGREES || score(fine) < score(0) * MIN_GAIN) return 0
  return Math.round(fine * 100) / 100
}
