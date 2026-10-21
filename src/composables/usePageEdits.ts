import { computed, ref } from 'vue'
import { withScaleStep, type PageOp } from '../tiff/pageOps'

interface EditState {
  /** Clockwise rotation per page, in degrees. */
  rotations: number[]
  /** Pixel and paper-size edits per page, applied in order. */
  ops: PageOp[][]
  /** Deleted pages stay in the file (so Undo can restore them) but are hidden everywhere. */
  deleted: boolean[]
  /** Page indexes (into the file) in display order. */
  order: number[]
}

function normalize(degrees: number): number {
  return ((degrees % 360) + 360) % 360
}

function emptyState(pageCount: number): EditState {
  return {
    rotations: new Array<number>(pageCount).fill(0),
    ops: Array.from({ length: pageCount }, () => []),
    deleted: new Array<boolean>(pageCount).fill(false),
    order: Array.from({ length: pageCount }, (_, i) => i),
  }
}

/**
 * `state` sized for pages `added` (new file indexes). `present`: they're placed before page `before` in the
 * order (at the end if it isn't there); otherwise (states from before they were inserted) they're left out of
 * the order, so they're neither shown nor counted as deleted.
 */
function withPages(state: EditState, added: readonly number[], before: number | null, present: boolean): EditState {
  const pageCount = Math.max(state.rotations.length, ...added.map((page) => page + 1))
  const extend = <T>(values: readonly T[], fill: T) =>
    Array.from({ length: pageCount }, (_, page) => (page < values.length ? values[page] : fill))
  const order = state.order.filter((page) => !added.includes(page))
  if (present) {
    const at = before === null ? -1 : order.indexOf(before)
    order.splice(at < 0 ? order.length : at, 0, ...added)
  }
  return {
    ...state,
    rotations: extend(state.rotations, 0),
    ops: extend<PageOp[]>(state.ops, []),
    deleted: extend(state.deleted, true).map((isDeleted, page) => (added.includes(page) ? !present : isDeleted)),
    order,
  }
}

/**
 * Moves every page in `targets` one place up (direction -1) or down (+1) in `pages`. Adjacent targets move
 * as a block; a block already at the edge stays put. Returns the new order, or null if nothing can move.
 */
export function movePagesWithin(pages: readonly number[], targets: ReadonlySet<number>, direction: -1 | 1): number[] | null {
  const next = [...pages]
  let changed = false
  const start = direction < 0 ? 0 : next.length - 1
  for (let position = start; position >= 0 && position < next.length; position -= direction) {
    const neighbour = position + direction
    if (!targets.has(next[position]) || neighbour < 0 || neighbour >= next.length || targets.has(next[neighbour])) continue
    ;[next[position], next[neighbour]] = [next[neighbour], next[position]]
    changed = true
  }
  return changed ? next : null
}

/**
 * Moves the pages in `targets` (keeping their order) to just before page `before` in `pages`, or to the end
 * when `before` is null. Returns the new order, or null if nothing moves.
 */
export function movePagesBefore(pages: readonly number[], targets: ReadonlySet<number>, before: number | null): number[] | null {
  const moving = pages.filter((page) => targets.has(page))
  const rest = pages.filter((page) => !targets.has(page))
  if (moving.length === 0) return null
  let at = rest.length
  if (before !== null) {
    const from = pages.indexOf(before)
    if (from < 0) return null
    // Dropped before one of the moving pages: the block lands before the next page that stays.
    const anchor = pages.slice(from).find((page) => !targets.has(page))
    if (anchor !== undefined) at = rest.indexOf(anchor)
  }
  const next = [...rest.slice(0, at), ...moving, ...rest.slice(at)]
  return next.some((page, i) => page !== pages[i]) ? next : null
}

/**
 * Page edits for the open document: rotation, pixel edits (erase, contrast, despeckle), deletion and order of pages.
 * Annotations are not edits: the host adds them and burns them in with its own call.
 * Edits stay pending until applied or cancelled; Undo steps back through pending edits. `hasChanges` (the
 * document is dirty) compares the pending state with the committed one, so undoing back to it is clean again.
 */
export function usePageEdits() {
  const committed = ref<EditState>(emptyState(0))
  const pending = ref<EditState>(emptyState(0))
  const history = ref<EditState[]>([])

  const rotations = computed<readonly number[]>(() => pending.value.rotations)
  const ops = computed<readonly (readonly PageOp[])[]>(() => pending.value.ops)
  const deleted = computed<readonly boolean[]>(() => pending.value.deleted)
  /** Indexes of the pages that are not deleted, in display order. */
  const visiblePages = computed(() => pending.value.order.filter((page) => !pending.value.deleted[page]))
  /** Pages deleted by the user (Undo / Cancel bring them back); not inserted pages that were taken out again. */
  const deletedCount = computed(() => pending.value.order.length - visiblePages.value.length)
  const hasChanges = computed(() => JSON.stringify(pending.value) !== JSON.stringify(committed.value))
  const canUndo = computed(() => history.value.length > 0)

  function update(next: EditState) {
    history.value.push(pending.value)
    pending.value = next
  }

  /** Records a new order of the visible pages; deleted pages keep their slots. */
  function reorderVisible(visible: readonly number[]) {
    let next = 0
    const order = pending.value.order.map((page) => (pending.value.deleted[page] ? page : visible[next++]))
    update({ ...pending.value, order })
  }

  return {
    rotations,
    ops,
    deleted,
    visiblePages,
    deletedCount,
    hasChanges,
    canUndo,
    reset(pageCount: number) {
      committed.value = emptyState(pageCount)
      pending.value = emptyState(pageCount)
      history.value = []
    },
    rotatePages(pages: readonly number[], degrees: number) {
      if (pages.length === 0) return
      const targets = new Set(pages)
      update({
        ...pending.value,
        rotations: pending.value.rotations.map((rotation, i) => (targets.has(i) ? normalize(rotation + degrees) : rotation)),
      })
    },
    rotateAll(degrees: number) {
      update({ ...pending.value, rotations: pending.value.rotations.map((rotation) => normalize(rotation + degrees)) })
    },
    addOp(page: number, op: PageOp) {
      update({
        ...pending.value,
        ops: pending.value.ops.map((pageOps, i) => (i === page ? [...pageOps, op] : pageOps)),
      })
    },
    /** Scales the content of several pages by one step (see withScaleStep), as a single undo step. */
    scalePages(pages: readonly number[], step: number) {
      if (pages.length === 0) return
      const targets = new Set(pages)
      update({
        ...pending.value,
        ops: pending.value.ops.map((pageOps, i) => (targets.has(i) ? withScaleStep(pageOps, step) : pageOps)),
      })
    },
    /** Adds ops to several pages as a single undo step. */
    addOps(pageOps: ReadonlyMap<number, readonly PageOp[]>) {
      if (![...pageOps.values()].some((ops) => ops.length > 0)) return
      update({
        ...pending.value,
        ops: pending.value.ops.map((existing, i) => [...existing, ...(pageOps.get(i) ?? [])]),
      })
    },
    /** Replaces the ops of several pages as a single undo step. */
    setOps(pageOps: ReadonlyMap<number, readonly PageOp[]>) {
      if (pageOps.size === 0) return
      update({
        ...pending.value,
        ops: pending.value.ops.map((existing, i) => (pageOps.has(i) ? [...pageOps.get(i)!] : existing)),
      })
    },
    /** Marks pages as deleted. Refuses to delete every remaining page; returns whether anything changed. */
    deletePages(pages: readonly number[]): boolean {
      const targets = new Set(pages.filter((page) => pending.value.deleted[page] === false))
      if (targets.size === 0 || targets.size >= visiblePages.value.length) return false
      update({ ...pending.value, deleted: pending.value.deleted.map((isDeleted, i) => isDeleted || targets.has(i)) })
      return true
    },
    /**
     * Moves pages one place up (-1) or down (+1) among the visible pages. Deleted pages keep their slot,
     * so Undo of a delete restores them where they were. Returns whether anything moved.
     */
    movePages(pages: readonly number[], direction: -1 | 1): boolean {
      const moved = movePagesWithin(visiblePages.value, new Set(pages), direction)
      if (!moved) return false
      reorderVisible(moved)
      return true
    },
    /** Moves pages (as a block, in display order) before page `before`, or to the end when null. */
    movePagesBefore(pages: readonly number[], before: number | null): boolean {
      const moved = movePagesBefore(visiblePages.value, new Set(pages), before)
      if (!moved) return false
      reorderVisible(moved)
      return true
    },
    /**
     * Shows newly added document pages (`added`: their file indexes) before page `before` in the display order.
     * Earlier states (undo history, the committed state) get them hidden, so Undo / Cancel take them out again.
     */
    insertPages(added: readonly number[], before: number | null) {
      if (added.length === 0) return
      committed.value = withPages(committed.value, added, before, false)
      history.value = history.value.map((state) => withPages(state, added, before, false))
      history.value.push(withPages(pending.value, added, before, false))
      pending.value = withPages(pending.value, added, before, true)
    },
    undo() {
      const previous = history.value.pop()
      if (previous) pending.value = previous
    },
    /** Commits the pending toolbar edits. Annotations are left as they are. */
    apply() {
      committed.value = pending.value
      history.value = []
    },
    cancel() {
      pending.value = committed.value
      history.value = []
    },
  }
}
