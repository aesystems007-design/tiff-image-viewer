import { FONT_FAMILY, LINE_HEIGHT, isImageRun, paragraphSize, type ImageRun, type RichText, type TextRun } from './richText'

type Context = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

/** Baseline position within a line box, in ems: half-leading plus Arial's ascent, as CSS lays it out. */
const BASELINE_EM = (LINE_HEIGHT - 1.117) / 2 + 0.905

type Piece =
  | { kind: 'text'; text: string; run: TextRun; width: number }
  | { kind: 'image'; run: ImageRun; width: number; height: number }

function font(run: TextRun, pxPerPt: number): string {
  return `${run.italic ? 'italic ' : ''}${run.bold ? 'bold ' : ''}${run.size * pxPerPt}px ${FONT_FAMILY}`
}

function isSpace(piece: Piece): boolean {
  return piece.kind === 'text' && piece.text.trim() === ''
}

/** Splits a word that is wider than the line into pieces that fit (CSS `overflow-wrap: anywhere`). */
function splitWord(ctx: Context, word: Piece & { kind: 'text' }, maxWidth: number): Piece[] {
  const pieces: Piece[] = []
  let text = ''
  for (const char of word.text) {
    if (text !== '' && ctx.measureText(text + char).width > maxWidth) {
      pieces.push({ kind: 'text', text, run: word.run, width: ctx.measureText(text).width })
      text = ''
    }
    text += char
  }
  if (text !== '') pieces.push({ kind: 'text', text, run: word.run, width: ctx.measureText(text).width })
  return pieces
}

/** An inline picture, shrunk to the line when it is wider than the box. */
function imagePiece(run: ImageRun, maxWidth: number, pxPerPt: number): Piece {
  let width = Math.max(1, run.width * pxPerPt)
  let height = Math.max(1, run.height * pxPerPt)
  if (width > maxWidth) {
    height *= maxWidth / width
    width = maxWidth
  }
  return { kind: 'image', run, width, height }
}

/**
 * Draws rich text with its top-left corner at the origin, wrapped to `width` px, like the annotation
 * overlay does in CSS (`white-space: pre-wrap`, line-height 1.2). Pictures sit in the line with the
 * words (`vertical-align: middle`). `images` supplies a decoded bitmap per picture address.
 * `pxPerPt` converts point sizes to pixels. Returns the height of the text.
 */
export function drawRichText(
  ctx: Context,
  text: RichText,
  width: number,
  pxPerPt: number,
  images?: ReadonlyMap<string, CanvasImageSource>,
): number {
  ctx.textBaseline = 'alphabetic'
  let top = 0
  for (const paragraph of text) {
    const lines: Piece[][] = [[]]
    let lineWidth = 0
    const add = (piece: Piece) => {
      lines[lines.length - 1].push(piece)
      lineWidth += piece.width
    }
    for (const run of paragraph.runs) {
      if (isImageRun(run)) {
        const piece = imagePiece(run, width, pxPerPt)
        if (lineWidth + piece.width > width && lines[lines.length - 1].some((item) => !isSpace(item))) {
          lines.push([])
          lineWidth = 0
        }
        add(piece)
        continue
      }
      ctx.font = font(run, pxPerPt)
      for (const token of run.text.split(/(\s+)/)) {
        if (token === '') continue
        const piece: Piece & { kind: 'text' } = { kind: 'text', text: token, run, width: ctx.measureText(token).width }
        if (/^\s+$/.test(token)) {
          add(piece)
          continue
        }
        if (lineWidth + piece.width > width && lines[lines.length - 1].some((item) => !isSpace(item))) {
          lines.push([])
          lineWidth = 0
        }
        for (const part of piece.width > width ? splitWord(ctx, piece, width) : [piece]) {
          if (lineWidth + part.width > width && lines[lines.length - 1].length > 0) {
            lines.push([])
            lineWidth = 0
          }
          add(part)
        }
      }
    }

    const fallbackSize = paragraphSize(paragraph) * pxPerPt
    for (const line of lines) {
      // Whitespace at a wrap point hangs off the end of the line in CSS, so it doesn't count for alignment.
      while (line.length > 0 && isSpace(line[0]) && line !== lines[0]) line.shift()
      const visible = [...line]
      while (visible.length > 0 && isSpace(visible[visible.length - 1])) visible.pop()
      const textSize =
        visible.reduce((max, piece) => (piece.kind === 'text' ? Math.max(max, piece.run.size * pxPerPt) : max), 0) || fallbackSize
      const imageHeight = visible.reduce((max, piece) => (piece.kind === 'image' ? Math.max(max, piece.height) : max), 0)
      const lineBox = Math.max(textSize * LINE_HEIGHT, imageHeight)
      const used = visible.reduce((sum, piece) => sum + piece.width, 0)
      let x = paragraph.align === 'center' ? (width - used) / 2 : paragraph.align === 'right' ? width - used : 0
      const baseline = top + (lineBox - textSize * LINE_HEIGHT) / 2 + textSize * BASELINE_EM
      for (const piece of visible) {
        if (piece.kind === 'image') {
          const bitmap = images?.get(piece.run.image)
          if (bitmap) ctx.drawImage(bitmap, x, top + (lineBox - piece.height) / 2, piece.width, piece.height)
        } else {
          ctx.font = font(piece.run, pxPerPt)
          ctx.fillStyle = piece.run.color
          ctx.fillText(piece.text, x, baseline)
          if (piece.run.underline) {
            const thickness = Math.max(1, (piece.run.size * pxPerPt) / 15)
            ctx.fillRect(x, baseline + thickness * 1.5, piece.width, thickness)
          }
        }
        x += piece.width
      }
      top += lineBox
    }
  }
  return top
}
