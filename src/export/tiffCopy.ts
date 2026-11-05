/**
 * Copies one page's compressed strips (or tiles) out of an existing TIFF into a new little-endian file.
 * Tag values are re-read from the file bytes: utif's decoded tags turn rationals into numbers and are not
 * a safe way to rebuild the IFD.
 */

/** One TIFF tag. `value` is little-endian and, when longer than 4 bytes, is written out of line. */
export interface TiffEntry {
  tag: number
  type: number
  count: number
  value: Uint8Array
  /** `value` is one LONG per strip, filled with the offsets where `strips` are placed. */
  strips?: boolean
}

/** One page of an output TIFF: its IFD, plus the strip or tile bytes in order. */
export interface TiffPage {
  entries: TiffEntry[]
  strips: Uint8Array[]
}

/** Bytes per value, indexed by TIFF type (1–12). RATIONAL is two LONGS, so 8. */
const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8]
/** Width of one endian swap. RATIONAL and SRATIONAL swap as two 4-byte units, not one 8-byte unit. */
const SWAP_WIDTH = [0, 1, 1, 2, 4, 4, 1, 1, 2, 4, 4, 4, 8]

/**
 * Tags whose value is a pointer at another IFD (or at free space). Left in place they would point at
 * whatever now sits at that offset. utif follows 330, 34665 and 50740 while reading, so those have to go.
 */
const DROP_TAGS = new Set([288, 289, 330, 34665, 34853, 40965, 50740])
/** Old JPEG table offsets. Their byte lengths are not in the file, so the page is re-encoded instead. */
const UNSAFE_OFFSET_TAGS = [519, 520, 521]

const STRIP_OFFSETS = 273
const STRIP_COUNTS = 279
const TILE_OFFSETS = 324
const TILE_COUNTS = 325
const JPEG_OFFSET = 513
const JPEG_LENGTH = 514

const MAX_IFDS = 100_000
const MAX_ENTRIES = 20_000

/**
 * Offsets of the image IFDs, in file order. Reduced-resolution IFDs (NewSubfileType bit 0) are skipped,
 * matching the worker; if every IFD is one, they are all kept, which is also what the worker does.
 * Returns nothing for a buffer that is not a TIFF.
 */
export function imageIfdOffsets(buffer: ArrayBuffer): number[] {
  if (buffer.byteLength < 8) return []
  const view = new DataView(buffer)
  const order = view.getUint16(0, false)
  const le = order === 0x4949
  if (!le && order !== 0x4d4d) return []
  if (view.getUint16(2, le) !== 42) return []

  const all: { offset: number; reduced: boolean }[] = []
  const seen = new Set<number>()
  let offset = view.getUint32(4, le)
  while (offset !== 0 && all.length < MAX_IFDS) {
    if (seen.has(offset) || offset + 2 > buffer.byteLength) break
    seen.add(offset)
    const count = view.getUint16(offset, le)
    const bytes = 2 + count * 12 + 4
    if (count > MAX_ENTRIES || offset + bytes > buffer.byteLength) break
    all.push({ offset, reduced: isReduced(view, le, offset, count) })
    offset = view.getUint32(offset + 2 + count * 12, le)
  }
  const kept = all.filter((ifd) => !ifd.reduced)
  return (kept.length > 0 ? kept : all).map((ifd) => ifd.offset)
}

/**
 * One page, ready to drop into a new file, or null when the page should be re-encoded instead
 * (offsets missing or out of range, an unknown tag type, or old JPEG tables).
 * `pageIndex` is 0-based in the output file and replaces the PageNumber tag.
 * Strip and tile bytes are copied as they sit in the file; they are not byte-swapped.
 */
export function copyOriginalPage(
  buffer: ArrayBuffer,
  ifdOffset: number,
  pageIndex: number,
  pageCount: number,
): TiffPage | null {
  if (ifdOffset < 0 || buffer.byteLength < 8) return null
  const view = new DataView(buffer)
  const order = view.getUint16(0, false)
  const le = order === 0x4949
  if (!le && order !== 0x4d4d) return null
  const parsed = readIfd(view, le, ifdOffset)
  if (!parsed) return null
  if (parsed.some((entry) => UNSAFE_OFFSET_TAGS.includes(entry.tag))) return null

  const tags = new Set(parsed.map((entry) => entry.tag))
  const offsetTag = tags.has(STRIP_OFFSETS)
    ? STRIP_OFFSETS
    : tags.has(TILE_OFFSETS)
      ? TILE_OFFSETS
      : tags.has(JPEG_OFFSET)
        ? JPEG_OFFSET
        : 0
  if (!offsetTag) return null
  const lengthTag = offsetTag === STRIP_OFFSETS ? STRIP_COUNTS : offsetTag === TILE_OFFSETS ? TILE_COUNTS : JPEG_LENGTH

  const drop = new Set(DROP_TAGS)
  for (const tag of [STRIP_OFFSETS, STRIP_COUNTS, TILE_OFFSETS, TILE_COUNTS, JPEG_OFFSET, JPEG_LENGTH]) {
    if (tag !== offsetTag && tag !== lengthTag) drop.add(tag)
  }
  // Tile size tags belong to the tile offsets. A strip copy leaves them behind.
  if (offsetTag !== TILE_OFFSETS) {
    drop.add(322)
    drop.add(323)
  }

  const offsetEntry = parsed.find((entry) => entry.tag === offsetTag)
  const lengthEntry = parsed.find((entry) => entry.tag === lengthTag)
  if (!offsetEntry || !lengthEntry) return null
  const offsets = uintList(offsetEntry)
  const lengths = uintList(lengthEntry)
  if (!offsets || !lengths || offsets.length === 0 || offsets.length !== lengths.length) return null

  const strips: Uint8Array[] = []
  for (let i = 0; i < offsets.length; i++) {
    const start = offsets[i]
    const length = lengths[i]
    if (length === 0) {
      strips.push(new Uint8Array())
      continue
    }
    if (start + length > buffer.byteLength) return null
    strips.push(new Uint8Array(buffer, start, length))
  }

  const entries: TiffEntry[] = []
  let numbered = false
  for (const entry of parsed) {
    if (drop.has(entry.tag)) continue
    if (entry.tag === offsetTag) {
      entries.push({
        tag: offsetTag,
        type: 4,
        count: strips.length,
        value: new Uint8Array(strips.length * 4),
        strips: true,
      })
      continue
    }
    if (entry.tag === 297) {
      if (!numbered) entries.push(pageNumber(pageIndex, pageCount))
      numbered = true
      continue
    }
    entries.push(entry)
  }
  if (!numbered) entries.push(pageNumber(pageIndex, pageCount))
  entries.sort((a, b) => a.tag - b.tag)
  return { entries, strips }
}

function isReduced(view: DataView, le: boolean, offset: number, count: number): boolean {
  for (let i = 0; i < count; i++) {
    const p = offset + 2 + i * 12
    if (view.getUint16(p, le) !== 254) continue
    const type = view.getUint16(p + 2, le)
    const n = view.getUint32(p + 4, le)
    const value = readEntryValue(view, le, p, type, n)
    if (!value || value.byteLength === 0) return false
    const bits = value.byteLength >= 2 ? new DataView(value.buffer, value.byteOffset, value.byteLength).getUint16(0, true) : value[0]
    return (bits & 1) === 1
  }
  return false
}

function readIfd(view: DataView, le: boolean, offset: number): TiffEntry[] | null {
  if (offset < 0 || offset + 2 > view.byteLength) return null
  const count = view.getUint16(offset, le)
  const bytes = 2 + count * 12 + 4
  if (count > MAX_ENTRIES || offset + bytes > view.byteLength) return null
  const entries: TiffEntry[] = []
  for (let i = 0; i < count; i++) {
    const p = offset + 2 + i * 12
    const tag = view.getUint16(p, le)
    const type = view.getUint16(p + 2, le)
    const n = view.getUint32(p + 4, le)
    if (n === 0) continue
    const value = readEntryValue(view, le, p, type, n)
    if (!value) return null
    entries.push({ tag, type, count: n, value })
  }
  return entries
}

/** The entry's value as little-endian bytes, copied out of the file. Null when the type or range is unusable. */
function readEntryValue(view: DataView, le: boolean, entry: number, type: number, count: number): Uint8Array | null {
  const unit = TYPE_SIZE[type]
  const swap = SWAP_WIDTH[type]
  if (!unit || !swap || count <= 0) return null
  const size = unit * count
  if (!Number.isSafeInteger(size) || size > view.byteLength) return null
  const src = size <= 4 ? entry + 8 : view.getUint32(entry + 8, le)
  if (src < 0 || src + size > view.byteLength) return null
  const raw = new Uint8Array(view.buffer, view.byteOffset + src, size)
  if (le || swap === 1) return new Uint8Array(raw)
  const out = new Uint8Array(size)
  for (let i = 0; i < size; i += swap) {
    for (let j = 0; j < swap; j++) out[i + j] = raw[i + swap - 1 - j]
  }
  return out
}

function uintList(entry: TiffEntry): number[] | null {
  const view = new DataView(entry.value.buffer, entry.value.byteOffset, entry.value.byteLength)
  if (entry.type === 3) {
    if (entry.value.byteLength < entry.count * 2) return null
    return Array.from({ length: entry.count }, (_, i) => view.getUint16(i * 2, true))
  }
  if (entry.type === 4) {
    if (entry.value.byteLength < entry.count * 4) return null
    return Array.from({ length: entry.count }, (_, i) => view.getUint32(i * 4, true))
  }
  return null
}

function pageNumber(index: number, total: number): TiffEntry {
  const value = new Uint8Array(4)
  const view = new DataView(value.buffer)
  view.setUint16(0, index, true)
  view.setUint16(2, total, true)
  return { tag: 297, type: 3, count: 2, value }
}
