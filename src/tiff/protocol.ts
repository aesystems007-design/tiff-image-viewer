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
  | { id: number; type: 'render'; page: number; ops: readonly PageOp[] }
  | { id: number; type: 'thumbnail'; page: number; ops: readonly PageOp[] }
  /** Measures the skew of a page with `ops` applied. */
  | { id: number; type: 'skew'; page: number; ops: readonly PageOp[] }
  /**
   * Checks which of `regions` contain non-white ink on the page with `ops` applied.
   * Returns the `id` of each region that has content (for margin / keep-clear warnings).
   */
  | { id: number; type: 'inspect-regions'; page: number; ops: readonly PageOp[]; regions: readonly { id: string; rect: ImageRect }[] }
  /** Writes `pages`, in this order, to one PDF or multi-page TIFF file. */
  | { id: number; type: 'export'; pages: readonly ExportPage[]; format: ExportFormat }

export type WorkerResponse =
  | { id: number; type: 'opened'; pages: PageInfo[] }
  /** The appended pages only. */
  | { id: number; type: 'added'; pages: PageInfo[] }
  | { id: number; type: 'rendered'; page: number; blob: Blob; thumbnail: Blob }
  | { id: number; type: 'thumbnail'; page: number; blob: Blob }
  /** Degrees, clockwise positive; 0 = straight or not measurable. */
  | { id: number; type: 'skew'; page: number; angle: number }
  | { id: number; type: 'regions-hit'; page: number; hits: string[] }
  | { id: number; type: 'exported'; blob: Blob }
  | { id: number; type: 'error'; message: string }
