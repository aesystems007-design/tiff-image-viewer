import { computed, ref } from 'vue'

/**
 * Page selection (0-based page indexes), driven by the thumbnail sidebar.
 * Plain click selects one page, Ctrl/Cmd+click toggles a page, Shift+click selects a range
 * from the last clicked page. At least one page always stays selected.
 * `visiblePages` (document order, deleted pages left out) defines ranges and "all".
 */
export function usePageSelection(visiblePages: () => readonly number[]) {
  const selected = ref<ReadonlySet<number>>(new Set([0]))
  let anchor = 0

  const pages = computed(() => [...selected.value].sort((a, b) => a - b))
  const count = computed(() => selected.value.size)

  return {
    selected,
    pages,
    count,
    selectOnly(page: number) {
      selected.value = new Set([page])
      anchor = page
    },
    /** Returns whether the page is selected afterwards. */
    toggle(page: number): boolean {
      const next = new Set(selected.value)
      if (!next.has(page)) next.add(page)
      else if (next.size > 1) next.delete(page)
      selected.value = next
      anchor = page
      return next.has(page)
    },
    /** Selects from the anchor (last plain/Ctrl-clicked page) to `page`; `additive` keeps the existing selection. */
    selectRange(page: number, additive: boolean) {
      const order = visiblePages()
      const to = order.indexOf(page)
      const from = order.indexOf(anchor)
      const next = new Set(additive ? selected.value : [])
      if (from < 0 || to < 0) next.add(page)
      else order.slice(Math.min(from, to), Math.max(from, to) + 1).forEach((p) => next.add(p))
      selected.value = next
    },
    selectAll() {
      selected.value = new Set(visiblePages())
    },
  }
}
