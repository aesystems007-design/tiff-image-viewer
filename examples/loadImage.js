import { asTiff } from '../src/api/asTiff.ts'

/**
 * Turns the file the user picked into the TIFF `open-image` sends.
 *
 * A company replaces this by setting `window.tiffHostLoadImage` before the upload runs.
 * That function receives the File (PDF or TIFF) and returns TIFF bytes from the company's API:
 *
 *   window.tiffHostLoadImage = async (file) => {
 *     const response = await fetch('/api/documents/replace', { method: 'POST', body: file })
 *     if (!response.ok) throw new Error('Replace failed.')
 *     return {
 *       buffer: await response.arrayBuffer(),
 *       name: file.name.replace(/\.pdf$/i, '.tif'),
 *       id: 'the-document-key',
 *     }
 *   }
 *
 * `buffer` is an ArrayBuffer or Blob of TIFF bytes. `name` is the file name shown in the viewer.
 * `id` is optional: omit it to keep the open document's key, `null` opens with no key.
 * Without this function, a TIFF is sent as-is and a PDF is converted by the local stand-in.
 */
export async function loadUploadedImage(file) {
  const custom = window.tiffHostLoadImage
  if (typeof custom === 'function') return normalize(await custom(file), file)
  const tiff = await asTiff(file)
  return { name: tiff.name, buffer: await tiff.arrayBuffer() }
}

async function normalize(result, file) {
  const value = result instanceof Blob || result instanceof ArrayBuffer ? { buffer: result } : result
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    throw new Error('tiffHostLoadImage must return TIFF bytes.')
  }
  const source = value.buffer
  const buffer = source instanceof ArrayBuffer ? source : source instanceof Blob ? await source.arrayBuffer() : null
  if (!buffer || buffer.byteLength === 0) throw new Error('tiffHostLoadImage must return TIFF bytes.')
  const name = typeof value.name === 'string' && value.name ? value.name : file.name
  const loaded = { name, buffer }
  if ('id' in value) loaded.id = value.id
  return loaded
}
