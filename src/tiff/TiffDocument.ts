import type { ImageRect } from '../viewer/imageRect'
import { opsKey, type PageOp } from './pageOps'
import type { ExportFormat, ExportPage, PageInfo, WorkerRequest, WorkerResponse } from './protocol'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

interface Pending {
  resolve: (response: WorkerResponse) => void
  reject: (error: Error) => void
  /** Thumbnail job: the next thumbnail is queued before background work (warning scans) can start. */
  thumbnail?: boolean
  /** Export only. Progress does not finish the job or free the worker. */
  onProgress?: (done: number, total: number) => void
}

interface Thumbnail {
  page: number
  revision: number
  ops: readonly PageOp[]
  promise: Promise<string>
  resolve: (url: string) => void
  reject: (error: Error) => void
  url?: string
  settled: boolean
  queued: boolean
}

interface WorkerJob {
  /** Lower runs first: 0 = render/export/open, 1 = thumbnails, 2 = warning inspect / skew. */
  priority: number
  seq: number
  start: () => void
}

/** Rendered versions (edit states) kept per page; older ones are evicted and their blob URLs revoked. */
const MAX_VERSIONS_PER_PAGE = 3
const PRIORITY_RENDER = 0
const PRIORITY_THUMBNAIL = 1
const PRIORITY_BACKGROUND = 2

function versionKey(page: number, revision: number, ops: readonly PageOp[]): string {
  return `${page}|${revision}|${opsKey(ops)}`
}

/** Callers may pass Vue reactive proxies, which postMessage cannot clone. */
function plainOps(ops: readonly PageOp[]): PageOp[] {
  return ops.length ? (JSON.parse(opsKey(ops)) as PageOp[]) : []
}

function pageOfKey(key: string): number {
  return Number(key.slice(0, key.indexOf('|')))
}

/**
 * An open TIFF file. Decoding happens in a dedicated Web Worker; each page (with its edits applied)
 * is rendered to a PNG blob URL on demand and cached until evicted or the document is disposed.
 */
export class TiffDocument {
  private static nextDocumentId = 1

  readonly id = TiffDocument.nextDocumentId++
  /** Revision 0 of every page: the opened file, then each inserted file. */
  pages: PageInfo[] = []
  /** Every image a page can show. Index 0 matches `pages`. Later entries are company deskew / despeckle results. */
  private revisionInfos: PageInfo[][] = []

  private nextId = 1
  private pending = new Map<number, Pending>()
  /** Insertion order doubles as least-recently-used order. */
  private pageUrls = new Map<string, Promise<string>>()
  private thumbnails = new Map<string, Thumbnail>()
  private thumbnailQueue: string[] = []
  private thumbnailInFlight = false
  /** Page the sidebar is showing; the closest queued thumbnail runs next. */
  private focusPage = 0
  private disposed = false
  /** One worker request at a time; renders jump ahead of warning scans / skew. */
  private jobQueue: WorkerJob[] = []
  private jobSeq = 0
  private workerBusy = false

  private constructor(
    readonly name: string,
    private readonly worker: Worker,
  ) {
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const response = event.data
      const pending = this.pending.get(response.id)
      if (!pending) return
      if (response.type === 'export-progress') {
        pending.onProgress?.(response.done, response.total)
        return
      }
      if (response.type === 'export-timing') {
        console.info(response.message)
        return
      }
      this.pending.delete(response.id)
      const wasThumbnail = pending.thumbnail === true
      if (response.type === 'error') pending.reject(new Error(response.message))
      else pending.resolve(response)
      this.workerBusy = false
      // Queue the next thumbnail before pumpJobs, or a warning scan already waiting would start
      // in the gap and every later thumbnail would wait on a full-page decode.
      if (wasThumbnail) this.thumbnailInFlight = false
      if (!this.thumbnailInFlight) this.pumpThumbnails()
      this.pumpJobs()
    })
    worker.addEventListener('error', (event) => {
      this.rejectAll(new Error(event.message || 'The TIFF decoder worker crashed.'))
    })
  }

  static async open(file: File): Promise<TiffDocument> {
    const buffer = await file.arrayBuffer()
    const worker = new Worker(new URL('./tiff.worker.ts', import.meta.url), { type: 'module' })
    const doc = new TiffDocument(file.name, worker)
    try {
      const response = await doc.send({ type: 'open', buffer }, [buffer])
      if (response.type !== 'opened') throw new Error('Unexpected response from TIFF decoder.')
      doc.pages = response.pages
      doc.revisionInfos = response.pages.map((info) => [info])
      return doc
    } catch (err) {
      doc.dispose()
      throw err
    }
  }

  /**
   * Appends the pages of another TIFF file to this document (after all existing pages); returns the index
   * of the first one and how many were added.
   */
  async addFile(file: File): Promise<{ first: number; count: number }> {
    const buffer = await file.arrayBuffer()
    const response = await this.send({ type: 'add', buffer }, [buffer])
    if (response.type !== 'added') throw new Error('Unexpected response from TIFF decoder.')
    const first = this.pages.length
    this.pages = [...this.pages, ...response.pages]
    this.revisionInfos.push(...response.pages.map((info) => [info]))
    return { first, count: response.pages.length }
  }

  /** The size of one page at `revision` (0 = the opened or inserted image), before pixel edits. */
  revisionInfo(page: number, revision: number): PageInfo {
    const list = this.revisionInfos[page]
    return list?.[revision] ?? list?.[0] ?? this.pages[page]
  }

  /**
   * Stores `tiff` as the next image of each file index in `pages` (one TIFF page each, same order).
   * Earlier images stay loaded so Undo can show them. Returns the revision number to display for each page.
   */
  async replacePages(tiff: ArrayBuffer, pages: readonly number[]): Promise<{ page: number; revision: number }[]> {
    const response = await this.send({ type: 'replace', buffer: tiff, pages }, [tiff])
    if (response.type !== 'replaced') throw new Error('Unexpected response from TIFF decoder.')
    for (const item of response.pages) {
      const list = this.revisionInfos[item.page]
      if (list) list[item.revision] = item.info
    }
    return response.pages.map(({ page, revision }) => ({ page, revision }))
  }

  get pageCount(): number {
    return this.pages.length
  }

  /** Returns a blob URL for a PNG rendering of the given page (0-based) with `ops` applied. */
  getPageUrl(page: number, ops: readonly PageOp[] = [], revision = 0): Promise<string> {
    const key = versionKey(page, revision, ops)
    let url = this.pageUrls.get(key)
    if (url) {
      this.pageUrls.delete(key)
    } else {
      ops = plainOps(ops)
      url = this.send({ type: 'render', page, revision, ops }, [], PRIORITY_RENDER).then((response) => {
        if (response.type !== 'rendered') throw new Error('Unexpected response from TIFF decoder.')
        this.provideThumbnail(page, revision, ops, response.thumbnail)
        return URL.createObjectURL(response.blob)
      })
      url.catch(() => this.pageUrls.delete(key))
    }
    this.pageUrls.set(key, url)
    this.evictPageUrls(page)
    return url
  }

  /**
   * The thumbnail nearest `page` is rendered next. The sidebar passes the page in the middle of the list
   * so scrolling to a later page doesn't wait out every thumbnail already queued above it.
   */
  setThumbnailFocus(page: number) {
    this.focusPage = page
  }

  /**
   * Returns a blob URL for a small PNG preview of the given page (0-based) with `ops` applied.
   * Requests are queued and sent one at a time so full-page renders are never stuck behind them.
   */
  getThumbnailUrl(page: number, ops: readonly PageOp[] = [], revision = 0): Promise<string> {
    ops = plainOps(ops)
    const key = versionKey(page, revision, ops)
    const thumbnail = this.thumbnailEntry(page, revision, ops)
    if (!thumbnail.settled && !thumbnail.queued) {
      thumbnail.queued = true
      this.thumbnailQueue.push(key)
      this.pumpThumbnails()
    }
    return thumbnail.promise
  }

  /** Skew of the given page (0-based) with `ops` applied, in degrees clockwise; 0 = straight or not measurable. */
  async measureSkew(page: number, ops: readonly PageOp[] = [], revision = 0): Promise<number> {
    const response = await this.send({ type: 'skew', page, revision, ops: plainOps(ops) }, [], PRIORITY_BACKGROUND)
    if (response.type !== 'skew') throw new Error('Unexpected response from TIFF decoder.')
    return response.angle
  }

  /**
   * Which of `regions` contain non-white ink on the page with `ops` applied.
   * Returns each region's `id`; used for margin / keep-clear overlap warnings.
   * Low priority so page navigation is never stuck behind a multi-page warning scan.
   */
  async inspectRegions(
    page: number,
    ops: readonly PageOp[],
    regions: readonly { id: string; rect: ImageRect }[],
    revision = 0,
  ): Promise<string[]> {
    if (regions.length === 0) return []
    const response = await this.send(
      { type: 'inspect-regions', page, revision, ops: plainOps(ops), regions },
      [],
      PRIORITY_BACKGROUND,
    )
    if (response.type !== 'regions-hit') throw new Error('Unexpected response from TIFF decoder.')
    return response.hits
  }

  /**
   * One PDF or multi-page TIFF file of `pages`, in that order, with their edits and rotations applied.
   * `onProgress` is called with the page about to be written (1-based) and the page count.
   */
  async exportFile(
    pages: readonly ExportPage[],
    format: ExportFormat,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Blob> {
    const started = performance.now()
    const plain = pages.map((page) => ({ ...page, ops: plainOps(page.ops) }))
    const response = await this.send({ type: 'export', pages: plain, format }, [], PRIORITY_RENDER, onProgress)
    if (response.type !== 'exported') throw new Error('Unexpected response from TIFF decoder.')
    const waited = Math.round((performance.now() - started) * 10) / 10
    console.info(`[tiff export] received ${format} (${response.blob.size} bytes) after ${waited}ms`)
    return response.blob
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.jobQueue = []
    this.worker.terminate()
    this.rejectAll(new Error('Document was closed.'))
    for (const url of this.pageUrls.values()) {
      url.then((u) => URL.revokeObjectURL(u), () => {})
    }
    this.pageUrls.clear()
    for (const thumbnail of this.thumbnails.values()) {
      if (thumbnail.url) URL.revokeObjectURL(thumbnail.url)
    }
    this.thumbnails.clear()
    this.thumbnailQueue = []
  }

  private evictPageUrls(page: number) {
    const keys = [...this.pageUrls.keys()].filter((key) => pageOfKey(key) === page)
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_VERSIONS_PER_PAGE))) {
      this.pageUrls.get(key)?.then((u) => URL.revokeObjectURL(u), () => {})
      this.pageUrls.delete(key)
    }
  }

  private evictThumbnails(page: number) {
    const keys = [...this.thumbnails.entries()]
      .filter(([key, thumbnail]) => pageOfKey(key) === page && thumbnail.settled)
      .map(([key]) => key)
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_VERSIONS_PER_PAGE))) {
      const url = this.thumbnails.get(key)?.url
      if (url) URL.revokeObjectURL(url)
      this.thumbnails.delete(key)
    }
  }

  private thumbnailEntry(page: number, revision: number, ops: readonly PageOp[]): Thumbnail {
    const key = versionKey(page, revision, ops)
    let thumbnail = this.thumbnails.get(key)
    if (!thumbnail) {
      let resolve!: (url: string) => void
      let reject!: (error: Error) => void
      const promise = new Promise<string>((res, rej) => {
        resolve = res
        reject = rej
      })
      thumbnail = { page, revision, ops, promise, resolve, reject, settled: false, queued: false }
      this.thumbnails.set(key, thumbnail)
    }
    return thumbnail
  }

  private provideThumbnail(page: number, revision: number, ops: readonly PageOp[], blob: Blob) {
    const thumbnail = this.thumbnailEntry(page, revision, ops)
    if (thumbnail.settled) return
    thumbnail.settled = true
    thumbnail.url = URL.createObjectURL(blob)
    thumbnail.resolve(thumbnail.url)
    this.evictThumbnails(page)
  }

  /** Drops finished entries and returns the queued thumbnail closest to `focusPage`. */
  private takeClosestThumbnail(): string | undefined {
    let bestKey: string | undefined
    let bestDist = Infinity
    const pending: string[] = []
    for (const key of this.thumbnailQueue) {
      const candidate = this.thumbnails.get(key)
      if (!candidate || candidate.settled) continue
      pending.push(key)
      const dist = Math.abs(candidate.page - this.focusPage)
      if (dist < bestDist) {
        bestDist = dist
        bestKey = key
      }
    }
    this.thumbnailQueue = bestKey === undefined ? [] : pending.filter((key) => key !== bestKey)
    return bestKey
  }

  private pumpThumbnails() {
    if (this.thumbnailInFlight || this.disposed) return
    const key = this.takeClosestThumbnail()
    if (!key) return
    const target = this.thumbnails.get(key)
    if (!target || target.settled) return

    const { page, revision, ops } = target
    this.thumbnailInFlight = true
    // The worker message handler queues the following thumbnail. Doing it here as well let a
    // background job start in between, so a long document's later pages waited twice.
    this.send({ type: 'thumbnail', page, revision, ops }, [], PRIORITY_THUMBNAIL)
      .then((response) => {
        if (response.type !== 'thumbnail') throw new Error('Unexpected response from TIFF decoder.')
        this.provideThumbnail(page, revision, ops, response.blob)
      })
      .catch((err: Error) => {
        const thumbnail = this.thumbnailEntry(page, revision, ops)
        if (thumbnail.settled) return
        thumbnail.settled = true
        thumbnail.reject(err)
      })
  }

  /**
   * Posts one request at a time. Lower `priority` runs first so full-page renders are not stuck behind
   * background margin scans on large documents.
   */
  private send(
    request: DistributiveOmit<WorkerRequest, 'id'>,
    transfer: Transferable[] = [],
    priority = PRIORITY_RENDER,
    onProgress?: (done: number, total: number) => void,
  ): Promise<WorkerResponse> {
    if (this.disposed) return Promise.reject(new Error('Document was closed.'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, thumbnail: request.type === 'thumbnail', onProgress })
      const seq = this.jobSeq++
      this.jobQueue.push({
        priority,
        seq,
        start: () => this.worker.postMessage({ ...request, id }, transfer),
      })
      this.jobQueue.sort((a, b) => a.priority - b.priority || a.seq - b.seq)
      this.pumpJobs()
    })
  }

  private pumpJobs() {
    if (this.workerBusy || this.disposed) return
    const job = this.jobQueue.shift()
    if (!job) return
    this.workerBusy = true
    job.start()
  }

  private rejectAll(error: Error) {
    this.jobQueue = []
    this.workerBusy = false
    this.thumbnailInFlight = false
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}
