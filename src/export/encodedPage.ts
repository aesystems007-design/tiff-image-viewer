/** One page ready to be written to a file: 8-bit samples, zlib (Deflate) compressed. */
export interface EncodedPage {
  width: number
  height: number
  dpiX: number
  dpiY: number
  /** One sample per pixel (grayscale) instead of three (RGB). */
  gray: boolean
  /** Rows top to bottom, zlib-wrapped Deflate: what TIFF compression 8 and PDF FlateDecode both expect. */
  data: Uint8Array
}

/** Compresses RGBA pixels (opaque) as grayscale when every pixel is gray, else as RGB. */
export async function encodePage(
  { data, width, height }: { data: Uint8ClampedArray; width: number; height: number },
  dpiX: number,
  dpiY: number,
): Promise<EncodedPage> {
  let gray = true
  for (let i = 0; i < data.length && gray; i += 4) gray = data[i] === data[i + 1] && data[i] === data[i + 2]
  const samples = new Uint8Array(width * height * (gray ? 1 : 3))
  if (gray) {
    for (let i = 0, j = 0; j < samples.length; i += 4, j++) samples[j] = data[i]
  } else {
    for (let i = 0, j = 0; j < samples.length; i += 4, j += 3) {
      samples[j] = data[i]
      samples[j + 1] = data[i + 1]
      samples[j + 2] = data[i + 2]
    }
  }
  return { width, height, dpiX, dpiY, gray, data: await deflate(samples) }
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
