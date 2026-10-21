import type { ImageRect } from '../viewer/imageRect'
import { opsKey, type PageOp } from './pageOps'
import type { ExportFormat, ExportPage, PageInfo, WorkerRequest, WorkerResponse } from './protocol'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

interface Pending {
  resolve: (response: WorkerResponse) => void
  reject: (error: Error) => void
}

interface Thumbnail {
  page: number
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

function versionKey(page: number, ops: readonly PageOp[]): string {
  return `${page}|${opsKey(ops)}`
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
  pages: PageInfo[] = []

  private nextId = 1
  private pending = new Map<number, Pending>()
  /** Insertion order doubles as least-recently-used order. */
  private pageUrls = new Map<string, Promise<string>>()
  private thumbnails = new Map<string, Thumbnail>()
  private thumbnailQueue: string[] = []
  private thumbnailInFlight = false
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
      this.pending.delete(response.id)
      if (response.type === 'error') pending.reject(new Error(response.message))
      else pending.resolve(response)
      this.workerBusy = false
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
    return { first, count: response.pages.length }
  }

  get pageCount(): number {
    return this.pages.length
  }

  /** Returns a blob URL for a PNG rendering of the given page (0-based) with `ops` applied. */
  getPageUrl(page: number, ops: readonly PageOp[] = []): Promise<string> {
    const key = versionKey(page, ops)
    let url = this.pageUrls.get(key)
    if (url) {
      this.pageUrls.delete(key)
    } else {
      ops = plainOps(ops)
      url = this.send({ type: 'render', page, ops }, [], PRIORITY_RENDER).then((response) => {
        if (response.type !== 'rendered') throw new Error('Unexpected response from TIFF decoder.')
        this.provideThumbnail(page, ops, response.thumbnail)
        return URL.createObjectURL(response.blob)
      })
      url.catch(() => this.pageUrls.delete(key))
    }
    this.pageUrls.set(key, url)
    this.evictPageUrls(page)
    return url
  }

  /**
   * Returns a blob URL for a small PNG preview of the given page (0-based) with `ops` applied.
   * Requests are queued and sent one at a time so full-page renders are never stuck behind them.
   */
  getThumbnailUrl(page: number, ops: readonly PageOp[] = []): Promise<string> {
    ops = plainOps(ops)
    const key = versionKey(page, ops)
    const thumbnail = this.thumbnailEntry(page, ops)
    if (!thumbnail.settled && !thumbnail.queued) {
      thumbnail.queued = true
      this.thumbnailQueue.push(key)
      this.pumpThumbnails()
    }
    return thumbnail.promise
  }

  /** Skew of the given page (0-based) with `ops` applied, in degrees clockwise; 0 = straight or not measurable. */
  async measureSkew(page: number, ops: readonly PageOp[] = []): Promise<number> {
    const response = await this.send({ type: 'skew', page, ops: plainOps(ops) }, [], PRIORITY_BACKGROUND)
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
  ): Promise<string[]> {
    if (regions.length === 0) return []
    const response = await this.send(
      { type: 'inspect-regions', page, ops: plainOps(ops), regions },
      [],
      PRIORITY_BACKGROUND,
    )
    if (response.type !== 'regions-hit') throw new Error('Unexpected response from TIFF decoder.')
    return response.hits
  }

  /** One PDF or multi-page TIFF file of `pages`, in that order, with their edits and rotations applied. */
  async exportFile(pages: readonly ExportPage[], format: ExportFormat): Promise<Blob> {
    const plain = pages.map((page) => ({ ...page, ops: plainOps(page.ops) }))
    const response = await this.send({ type: 'export', pages: plain, format }, [], PRIORITY_RENDER)
    if (response.type !== 'exported') throw new Error('Unexpected response from TIFF decoder.')
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

  private thumbnailEntry(page: number, ops: readonly PageOp[]): Thumbnail {
    const key = versionKey(page, ops)
    let thumbnail = this.thumbnails.get(key)
    if (!thumbnail) {
      let resolve!: (url: string) => void
      let reject!: (error: Error) => void
      const promise = new Promise<string>((res, rej) => {
        resolve = res
        reject = rej
      })
      thumbnail = { page, ops, promise, resolve, reject, settled: false, queued: false }
      this.thumbnails.set(key, thumbnail)
    }
    return thumbnail
  }

  private provideThumbnail(page: number, ops: readonly PageOp[], blob: Blob) {
    const thumbnail = this.thumbnailEntry(page, ops)
    if (thumbnail.settled) return
    thumbnail.settled = true
    thumbnail.url = URL.createObjectURL(blob)
    thumbnail.resolve(thumbnail.url)
    this.evictThumbnails(page)
  }

  private pumpThumbnails() {
    if (this.thumbnailInFlight || this.disposed) return
    let target: Thumbnail | undefined
    let key: string | undefined
    while ((key = this.thumbnailQueue.shift()) !== undefined) {
      const candidate = this.thumbnails.get(key)
      if (candidate && !candidate.settled) {
        target = candidate
        break
      }
    }
    if (!target) return

    const { page, ops } = target
    this.thumbnailInFlight = true
    this.send({ type: 'thumbnail', page, ops }, [], PRIORITY_THUMBNAIL)
      .then((response) => {
        if (response.type !== 'thumbnail') throw new Error('Unexpected response from TIFF decoder.')
        this.provideThumbnail(page, ops, response.blob)
      })
      .catch((err: Error) => {
        const thumbnail = this.thumbnailEntry(page, ops)
        if (thumbnail.settled) return
        thumbnail.settled = true
        thumbnail.reject(err)
      })
      .finally(() => {
        this.thumbnailInFlight = false
        this.pumpThumbnails()
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
  ): Promise<WorkerResponse> {
    if (this.disposed) return Promise.reject(new Error('Document was closed.'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
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
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}
