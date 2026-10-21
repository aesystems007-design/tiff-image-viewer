// Writes uncompressed RGB sample TIFFs to ./samples for manual testing.
// Each page shows its page number on a coloured grid; the multipage file also
// contains a reduced-resolution thumbnail IFD that the viewer should skip.
import { mkdirSync, writeFileSync } from 'node:fs'

const FONT = {
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '010', '010', '010'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
}

function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255))
}

function renderPage(width, height, label, hue) {
  const rgb = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gridLine = x % 100 === 0 || y % 100 === 0
      const [r, g, b] = gridLine ? [255, 255, 255] : hslToRgb(hue, 0.55, 0.25 + 0.35 * (x / width))
      const i = (y * width + x) * 3
      rgb[i] = r
      rgb[i + 1] = g
      rgb[i + 2] = b
    }
  }
  paintNumber(rgb, width, height, label, 255)
  return rgb
}

/** Paints `label` in big block digits centred on the page. */
function paintNumber(rgb, width, height, label, value) {
  const digits = String(label).split('')
  const cell = Math.floor(height / 10)
  const textWidth = digits.length * 4 * cell - cell
  const left = Math.floor((width - textWidth) / 2)
  const top = Math.floor((height - 5 * cell) / 2)
  digits.forEach((digit, d) => {
    FONT[digit].forEach((row, ry) => {
      for (let rx = 0; rx < 3; rx++) {
        if (row[rx] !== '1') continue
        for (let y = 0; y < cell; y++) {
          for (let x = 0; x < cell; x++) {
            const px = left + (d * 4 + rx) * cell + x
            const py = top + ry * cell + y
            rgb.fill(value, (py * width + px) * 3, (py * width + px) * 3 + 3)
          }
        }
      }
    })
  })
}

const SHORT = 3
const LONG = 4
const RATIONAL = 5
/** Scan resolution written to every page (XResolution/YResolution, inches). */
const DPI = 200

function writeTiff(path, images) {
  const layout = []
  let offset = 8
  for (const image of images) {
    const dataOffset = offset
    offset += image.rgb.length
    offset += offset % 2
    const bpsOffset = offset
    offset += 6
    const resolutionOffset = offset
    offset += 16
    const entries = [
      [254, LONG, 1, image.subfileType],
      [256, LONG, 1, image.width],
      [257, LONG, 1, image.height],
      [258, SHORT, 3, bpsOffset],
      [259, SHORT, 1, 1],
      [262, SHORT, 1, 2],
      [273, LONG, 1, dataOffset],
      [277, SHORT, 1, 3],
      [278, LONG, 1, image.height],
      [279, LONG, 1, image.rgb.length],
      [282, RATIONAL, 1, resolutionOffset],
      [283, RATIONAL, 1, resolutionOffset + 8],
      [284, SHORT, 1, 1],
      [296, SHORT, 1, 2],
    ]
    if (image.pageNumber) entries.push([297, SHORT, 2, image.pageNumber])
    const ifdOffset = offset
    offset += 2 + entries.length * 12 + 4
    layout.push({ image, dataOffset, bpsOffset, resolutionOffset, ifdOffset, entries })
  }

  const out = Buffer.alloc(offset)
  out.write('II', 0, 'ascii')
  out.writeUInt16LE(42, 2)
  out.writeUInt32LE(layout[0].ifdOffset, 4)

  layout.forEach(({ image, dataOffset, bpsOffset, resolutionOffset, ifdOffset, entries }, index) => {
    out.set(image.rgb, dataOffset)
    for (let i = 0; i < 3; i++) out.writeUInt16LE(8, bpsOffset + i * 2)
    for (let i = 0; i < 2; i++) {
      out.writeUInt32LE(DPI, resolutionOffset + i * 8)
      out.writeUInt32LE(1, resolutionOffset + i * 8 + 4)
    }
    out.writeUInt16LE(entries.length, ifdOffset)
    entries.forEach(([tag, type, count, value], i) => {
      const p = ifdOffset + 2 + i * 12
      out.writeUInt16LE(tag, p)
      out.writeUInt16LE(type, p + 2)
      out.writeUInt32LE(count, p + 4)
      if (Array.isArray(value)) value.forEach((v, j) => out.writeUInt16LE(v, p + 8 + j * 2))
      else if (type === SHORT && count === 1) out.writeUInt16LE(value, p + 8)
      else out.writeUInt32LE(value, p + 8)
    })
    const next = layout[index + 1]?.ifdOffset ?? 0
    out.writeUInt32LE(next, ifdOffset + 2 + entries.length * 12)
  })

  writeFileSync(path, out)
  console.log(`wrote ${path} (${images.length} IFDs, ${(out.length / 1e6).toFixed(1)} MB)`)
}

mkdirSync('samples', { recursive: true })

writeTiff('samples/single-page.tif', [
  { width: 2400, height: 1600, rgb: renderPage(2400, 1600, 1, 210), subfileType: 0 },
])

const PAGES = 5
const pages = []
for (let p = 0; p < PAGES; p++) {
  pages.push({
    width: 1600,
    height: 2000,
    rgb: renderPage(1600, 2000, p + 1, (p * 360) / PAGES),
    subfileType: 2,
    pageNumber: [p, PAGES],
  })
  if (p === 0) {
    pages.push({ width: 160, height: 200, rgb: renderPage(160, 200, 0, 0), subfileType: 1 })
  }
}
writeTiff('samples/multi-page.tif', pages)

// "Scanned" document: white pages, black page number, ruled lines, small dots that must survive
// despeckling, and random 1-3 px specks (fixed seed) that it should remove.
function renderScan(width, height, label, seed) {
  const rgb = new Uint8Array(width * height * 3).fill(255)
  const black = (x, y) => rgb.fill(0, (y * width + x) * 3, (y * width + x) * 3 + 3)
  let state = seed
  const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32)

  for (let row = 0; row < 12; row++) {
    const y = 300 + row * 120
    for (let x = 150; x < width - 150; x++) black(x, y)
    for (let dot = 0; dot < 6; dot++) {
      const cx = 200 + dot * 220
      for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 5; dx++) black(cx + dx, y - 20 + dy)
    }
  }
  for (let i = 0; i < 600; i++) {
    const size = 1 + Math.floor(random() * 3)
    const x = Math.floor(random() * (width - 4))
    const y = Math.floor(random() * (height - 4))
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) black(x + dx, y + dy)
  }

  paintNumber(rgb, width, height, label, 0)
  return rgb
}

// Skewed "scanned" text: lines of word-like blocks, rotated clockwise by `degrees` (negative = counter-clockwise),
// as if the sheet went through the scanner at an angle. Deskew should straighten pages 1 and 2 and leave page 3.
function renderSkewedScan(width, height, label, degrees, seed) {
  const upright = new Uint8Array(width * height * 3).fill(255)
  let state = seed
  const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  for (let y = 260; y < height - 200; y += 60) {
    if (random() < 0.12) continue
    let x = 150 + (random() < 0.2 ? 80 : 0)
    const end = width - 150 - (random() < 0.15 ? 400 : 0)
    while (x < end) {
      const word = Math.min(30 + Math.floor(random() * 110), end - x)
      for (let dy = 0; dy < 22; dy++) upright.fill(0, ((y + dy) * width + x) * 3, ((y + dy) * width + x + word) * 3)
      x += word + 18
    }
  }
  paintNumber(upright, width, height, label, 0)
  const rgb = new Uint8Array(width * height * 3)
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - width / 2
      const dy = y - height / 2
      const sx = Math.round(dx * cos + dy * sin + width / 2)
      const sy = Math.round(-dx * sin + dy * cos + height / 2)
      const inside = sx >= 0 && sx < width && sy >= 0 && sy < height
      rgb.fill(inside ? upright[(sy * width + sx) * 3] : 255, (y * width + x) * 3, (y * width + x) * 3 + 3)
    }
  }
  return rgb
}

const SKEWS = [2.5, -1.5, 0]
writeTiff(
  'samples/skewed.tif',
  SKEWS.map((degrees, p) => ({
    width: 1700,
    height: 2200,
    rgb: renderSkewedScan(1700, 2200, p + 1, degrees, (p + 1) * 104729),
    subfileType: 2,
    pageNumber: [p, SKEWS.length],
  })),
)

writeTiff(
  'samples/speckled.tif',
  [1, 2].map((label) => ({
    width: 1700,
    height: 2200,
    rgb: renderScan(1700, 2200, label, label * 7919),
    subfileType: 2,
    pageNumber: [label - 1, 2],
  })),
)
