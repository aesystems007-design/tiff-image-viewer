import type { ImageRect } from '../viewer/imageRect'
import type { PageOp } from './pageOps'

export interface PageInfo {
  width: number
  height: number
  /** Resolution in dots per inch from the TIFF tags, or null when the file doesn't say. */
  dpiX: number | null
  dpiY: number | null
}

/** A page to write to a downloaded file: `ops` (pending ones included) and `rotation` are applied. */
export interface ExportPage {
  page: number
  /** Which image this page shows. 0 is the file as opened; later numbers are company deskew / despeckle results. */
  revision: number
  ops: readonly PageOp[]
  rotation: number
  /** Resolution of the page as edited, before rotation. */
  dpiX: number
  dpiY: number
}

export type ExportFormat = 'pdf' | 'tiff'

export type WorkerRequest =
  | { id: number; type: 'open'; buffer: ArrayBuffer }
  /** Appends another file's pages to the document. */
  | { id: number; type: 'add'; buffer: ArrayBuffer }
  /**
   * Stores `buffer` (a TIFF, one page per index, same order) as the next revision of each page in `pages`.
   * The previous revisions stay, so Undo can show them again.
   */
  | { id: number; type: 'replace'; buffer: ArrayBuffer; pages: readonly number[] }
  | { id: number; type: 'render'; page: number; revision: number; ops: readonly PageOp[] }
  | { id: number; type: 'thumbnail'; page: number; revision: number; ops: readonly PageOp[] }
  /** Measures the skew of a page with `ops` applied. */
  | { id: number; type: 'skew'; page: number; revision: number; ops: readonly PageOp[] }
  /**
   * Checks which of `regions` contain non-white ink on the page with `ops` applied.
   * Returns the `id` of each region that has content (for margin / keep-clear warnings).
   */
  | { id: number; type: 'inspect-regions'; page: number; revision: number; ops: readonly PageOp[]; regions: readonly { id: string; rect: ImageRect }[] }
  /**
   * Writes `pages`, in this order, to one PDF or multi-page TIFF file.
   * A TIFF copies the original strips of a page with no edits and no rotation, and re-encodes the rest.
   * While it runs the worker posts `export-progress` for the same id; that does not finish the job.
   */
  | { id: number; type: 'export'; pages: readonly ExportPage[]; format: ExportFormat }

export type WorkerResponse =
  | { id: number; type: 'opened'; pages: PageInfo[] }
  /** The appended pages only. */
  | { id: number; type: 'added'; pages: PageInfo[] }
  /** One entry per page that was replaced, with the revision number to show and that image's size. */
  | { id: number; type: 'replaced'; pages: { page: number; revision: number; info: PageInfo }[] }
  | { id: number; type: 'rendered'; page: number; blob: Blob; thumbnail: Blob }
  | { id: number; type: 'thumbnail'; page: number; blob: Blob }
  /** Degrees, clockwise positive; 0 = straight or not measurable. */
  | { id: number; type: 'skew'; page: number; angle: number }
  | { id: number; type: 'regions-hit'; page: number; hits: string[] }
  | { id: number; type: 'exported'; blob: Blob }
  /** `done` is the page being written, 1-based. Sent before that page's work, and does not finish the export. */
  | { id: number; type: 'export-progress'; done: number; total: number }
  | { id: number; type: 'error'; message: string }
