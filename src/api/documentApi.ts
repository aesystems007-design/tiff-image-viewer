/** A document as a stand-in fetch hands it to the viewer. */
export interface ServerDocument {
  /** Key the caller asked for; every save of this document uses the same id. */
  id: string
  /** File name shown in the toolbar and offered for downloads. */
  name: string
  /** The image as uploaded: a (multi-page) TIFF, or a PDF that is converted to TIFF before it's shown. */
  file: Blob
}

/**
 * Fetches a document by id. Stand-in: reads `samples/<id>.tif`, else `samples/<id>.pdf` (dev server only),
 * e.g. id `multi-page` loads `samples/multi-page.tif`.
 */
export async function fetchDocument(id: string): Promise<ServerDocument> {
  for (const extension of ['tif', 'pdf']) {
    const name = `${id}.${extension}`
    const response = await fetch(`${import.meta.env.BASE_URL}samples/${encodeURIComponent(name)}`, { cache: 'no-store' })
    // The dev server answers unknown paths with index.html.
    if (response.ok && !response.headers.get('content-type')?.includes('text/html')) {
      return { id, name, file: await response.blob() }
    }
  }
  throw new Error(`Document ${id} was not found.`)
}

/**
 * Sends a new version of a document (the whole image as a multi-page TIFF) to the server. Stand-in until the
 * real API is wired up: logs the upload to the console and resolves after a short delay.
 */
export async function saveDocument(id: string, tiff: Blob): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 400))
  console.info(`[documentApi] saveDocument(${id}): ${(tiff.size / 1e6).toFixed(2)} MB TIFF (stand-in, nothing was sent)`)
}
