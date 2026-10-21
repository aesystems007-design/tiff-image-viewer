import { FONT_FAMILY, LINE_HEIGHT, paragraphSize, type RichText, type TextRun } from './richText'

type Context = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

/** Baseline position within a line box, in ems: half-leading plus Arial's ascent, as CSS lays it out. */
const BASELINE_EM = (LINE_HEIGHT - 1.117) / 2 + 0.905

interface Piece {
  text: string
  run: TextRun
  width: number
}

function font(run: TextRun, pxPerPt: number): string {
  return `${run.italic ? 'italic ' : ''}${run.bold ? 'bold ' : ''}${run.size * pxPerPt}px ${FONT_FAMILY}`
}

/** Splits a word that is wider than the line into pieces that fit (CSS `overflow-wrap: anywhere`). */
function splitWord(ctx: Context, word: Piece, maxWidth: number): Piece[] {
  const pieces: Piece[] = []
  let text = ''
  for (const char of word.text) {
    if (text !== '' && ctx.measureText(text + char).width > maxWidth) {
      pieces.push({ text, run: word.run, width: ctx.measureText(text).width })
      text = ''
    }
    text += char
  }
  if (text !== '') pieces.push({ text, run: word.run, width: ctx.measureText(text).width })
  return pieces
}

/**
 * Draws rich text with its top-left corner at the origin, wrapped to `width` px, like the annotation
 * overlay does in CSS (`white-space: pre-wrap`, line-height 1.2). `pxPerPt` converts point sizes to pixels.
 * Returns the height of the text.
 */
export function drawRichText(ctx: Context, text: RichText, width: number, pxPerPt: number): number {
  ctx.textBaseline = 'alphabetic'
  let top = 0
  for (const paragraph of text) {
    const lines: Piece[][] = [[]]
    let lineWidth = 0
    for (const run of paragraph.runs) {
      ctx.font = font(run, pxPerPt)
      for (const token of run.text.split(/(\s+)/)) {
        if (token === '') continue
        const piece = { text: token, run, width: ctx.measureText(token).width }
        const line = lines[lines.length - 1]
        if (/^\s+$/.test(token)) {
          line.push(piece)
          lineWidth += piece.width
          continue
        }
        if (lineWidth + piece.width > width && line.some((p) => p.text.trim() !== '')) {
          lines.push([])
          lineWidth = 0
        }
        for (const part of piece.width > width ? splitWord(ctx, piece, width) : [piece]) {
          if (lineWidth + part.width > width && lines[lines.length - 1].length > 0) {
            lines.push([])
            lineWidth = 0
          }
          lines[lines.length - 1].push(part)
          lineWidth += part.width
        }
      }
    }

    const fallbackSize = paragraphSize(paragraph) * pxPerPt
    for (const line of lines) {
      // Whitespace at a wrap point hangs off the end of the line in CSS, so it doesn't count for alignment.
      while (line.length > 0 && line[0].text.trim() === '' && line !== lines[0]) line.shift()
      const visible = [...line]
      while (visible.length > 0 && visible[visible.length - 1].text.trim() === '') visible.pop()
      const size = visible.reduce((max, piece) => Math.max(max, piece.run.size * pxPerPt), 0) || fallbackSize
      const used = visible.reduce((sum, piece) => sum + piece.width, 0)
      let x = paragraph.align === 'center' ? (width - used) / 2 : paragraph.align === 'right' ? width - used : 0
      const baseline = top + size * BASELINE_EM
      for (const piece of visible) {
        ctx.font = font(piece.run, pxPerPt)
        ctx.fillStyle = piece.run.color
        ctx.fillText(piece.text, x, baseline)
        if (piece.run.underline) {
          const thickness = Math.max(1, (piece.run.size * pxPerPt) / 15)
          ctx.fillRect(x, baseline + thickness * 1.5, piece.width, thickness)
        }
        x += piece.width
      }
      top += size * LINE_HEIGHT
    }
  }
  return top
}
