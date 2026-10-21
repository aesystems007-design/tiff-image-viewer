<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, triggerRef, watch } from 'vue'
import { annotationOp, type Annotation } from './annotations/annotation'
import type { RichText } from './annotations/richText'
import { asTiff } from './api/asTiff'
import { fetchDocument, saveDocument } from './api/documentApi'
import AnnotationEditor from './components/AnnotationEditor.vue'
import AppIcon from './components/AppIcon.vue'
import AreaActions from './components/AreaActions.vue'
import DownloadDialog from './components/DownloadDialog.vue'
import ImageWarnings from './components/ImageWarnings.vue'
import MoveAllPrompt from './components/MoveAllPrompt.vue'
import OsdViewer from './components/OsdViewer.vue'
import ThumbnailSidebar from './components/ThumbnailSidebar.vue'
import ViewerToolbar from './components/ViewerToolbar.vue'
import { movePagesWithin, usePageEdits } from './composables/usePageEdits'
import { usePageSelection } from './composables/usePageSelection'
import { dpiRequirement, pageRectToRequirement, requirementRectToPage, setDpiRequirement } from './host/dpiRequirement'
import {
  annotationKind,
  placedUneditableAnnotation,
  uneditableAnnotationOp,
  uneditableAnnotationPageIndex,
  uneditableAnnotationProblem,
  uneditableAnnotationRect,
  type UneditableAnnotation,
} from './host/uneditableAnnotation'
import { initialDocumentId, isHosted, listenToHost, notifyHost, type BurnedAnnotation, type HostCommand } from './host/hostBridge'
import { setIcons } from './icons/registry'
import { canScan, setScanLicense } from './scan/license'
import {
  legacyAnnotationBorder,
  legacyAnnotationName,
  legacyAnnotationPageIndex,
  legacyAnnotationProblem,
  legacyAnnotationRect,
  legacyAnnotationText,
  type LegacyAnnotation,
} from './host/legacyAnnotation'
import { loadMargins } from './margins/loadMargins'
import { marginGuides, pageMarginSpec, type MarginSpec } from './margins/margins'
import { printDocument } from './print/printDocument'
import {
  DEFAULT_SPECK_SIZE,
  DESPECKLE_LEVELS,
  editedPageInfo,
  withDespeckleStep,
  opsKey,
  pageResolution,
  paperOp,
  withShift,
  type PageOp,
  type PaperSize,
} from './tiff/pageOps'
import type { ExportFormat, ExportPage } from './tiff/protocol'
import { TiffDocument } from './tiff/TiffDocument'
import { DEFAULT_FIT_MODE, type FitMode } from './viewer/fitMode'
import { describeMove, screenInchesToShift, shiftToScreenInches, totalShift, type PageShift } from './viewer/contentShift'
import type { ImageRect } from './viewer/imageRect'
import type { PageGuide } from './viewer/pageGuide'
import { warningDetail, type ImageWarning } from './warnings/imageWarning'

const doc = shallowRef<TiffDocument | null>(null)
/** Host's key for the open document. Null means Apply only commits in memory. */
const documentId = ref<string | null>(null)
/** Key sent with the in-flight `save-requested`, so a later `set-id` still matches the ack. */
const savingId = ref<string | null>(null)
/** Margin rules for the open document (null = none, nothing drawn). */
const margins = shallowRef<MarginSpec | null>(null)
/**
 * This document's DPI requirement from `open-image`. Null uses the company's asserted requirement.
 * Cleared with the document.
 */
const documentDpi = ref<number | null>(null)
const page = ref(0)
const pageUrl = ref<string | null>(null)
/** The page whose image is currently in the viewer; lags `page` while the next one decodes. */
const shownPage = ref(0)
const busy = ref(false)
const error = ref<string | null>(null)
const dragging = ref(false)
const thumbnailsVisible = ref(true)
const fitMode = ref<FitMode | null>(DEFAULT_FIT_MODE)
const zoomPercent = ref<number | null>(null)
const brightness = ref(100)
const contrast = ref(100)
const selectAreaMode = ref(false)
/** Erase tool: each rectangle drawn on the page is erased to white right away. */
const eraseMode = ref(false)
/** Reposition tool: dragging on the page (or the arrow keys) moves the shown page's content. */
const repositionMode = ref(false)

/** Select-area, erase and reposition all use dragging on the page, so only one can be on. */
function setPageTool(tool: 'select' | 'erase' | 'reposition' | null) {
  selectAreaMode.value = tool === 'select'
  eraseMode.value = tool === 'erase'
  repositionMode.value = tool === 'reposition'
}

function toggleSelectAreaMode() {
  setPageTool(selectAreaMode.value ? null : 'select')
}

function toggleEraseMode() {
  setPageTool(eraseMode.value ? null : 'erase')
}

function toggleRepositionMode() {
  setPageTool(repositionMode.value ? null : 'reposition')
}
/** Area selected on the displayed page, in page pixels. */
const areaSelection = ref<ImageRect | null>(null)
/** Brightness/contrast being previewed on the selected area before it's applied, as a CSS filter. */
const areaPreviewFilter = ref<string | null>(null)
const viewer = ref<InstanceType<typeof OsdViewer>>()

const edits = usePageEdits()
const visiblePages = edits.visiblePages
const selection = usePageSelection(() => visiblePages.value)

/** `page` and friends are indexes into the file; the toolbar counts only pages that aren't deleted. */
const pagePosition = computed(() => Math.max(0, visiblePages.value.indexOf(page.value)))
const canDeletePages = computed(() => selection.count.value < visiblePages.value.length)
const canMoveUp = computed(() => movePagesWithin(visiblePages.value, selection.selected.value, -1) !== null)
const canMoveDown = computed(() => movePagesWithin(visiblePages.value, selection.selected.value, 1) !== null)
/** Page sizes with edits applied (indexed by file page). */
const pageInfos = computed(() => (doc.value?.pages ?? []).map((info, i) => editedPageInfo(info, opsOf(i))))
const pageInfo = computed(() => pageInfos.value[page.value] ?? null)
/**
 * Size of the page on screen for the status bar. A 90° or 270° rotation swaps the sides
 * (and which DPI each side uses), so the numbers match the page as displayed.
 */
const displayedPageSize = computed(() => {
  const info = pageInfo.value
  if (!info) return null
  const rotation = ((edits.rotations.value[page.value] ?? 0) % 360 + 360) % 360
  const sideways = rotation % 180 !== 0
  const { dpiX, dpiY } = pageResolution(info)
  const width = sideways ? info.height : info.width
  const height = sideways ? info.width : info.height
  const dpiW = sideways ? dpiY : dpiX
  const dpiH = sideways ? dpiX : dpiY
  return {
    width,
    height,
    inches: `${(width / dpiW).toFixed(2)}" × ${(height / dpiH).toFixed(2)}"`,
  }
})
const shownRotation = computed(() => edits.rotations.value[shownPage.value] ?? 0)
/** Identifies the shown page and its size: edits that keep the size are swapped in place, others reopen it. */
const shownPageKey = ref('')

/**
 * Margin guides per page (indexed by file page). First/last/default rules follow the current page order,
 * so they move with page moves and deletions; margins stay put on screen when a page is rotated.
 */
const guidesByPage = computed<PageGuide[][]>(() => {
  const spec = margins.value
  const pages = doc.value?.pages ?? []
  const guides: PageGuide[][] = pages.map(() => [])
  if (!spec) return guides
  const order = visiblePages.value
  order.forEach((index, position) => {
    const rules = pageMarginSpec(spec, position, order.length)
    guides[index] = marginGuides(rules, pageInfos.value[index], edits.rotations.value[index] ?? 0)
  })
  return guides
})
const pageGuides = computed(() => guidesByPage.value[shownPage.value] ?? [])

/** Margin / keep-clear overlaps found by scanning each page's ink against its guides. */
const imageWarnings = ref<ImageWarning[]>([])
const warningPages = computed(() => new Set(imageWarnings.value.map((warning) => warning.page)))
let warningToken = 0
let warningTimer: number | undefined
const WARNING_DEBOUNCE_MS = 350

function scheduleWarningScan() {
  window.clearTimeout(warningTimer)
  warningTimer = window.setTimeout(scanImageWarnings, WARNING_DEBOUNCE_MS)
}

/** Checks visible pages for content in margin bands and keep-clear areas; updates `imageWarnings`. */
async function scanImageWarnings() {
  const current = doc.value
  if (!current || !margins.value) {
    imageWarnings.value = []
    return
  }
  const token = ++warningToken
  const order = visiblePages.value
  const guides = guidesByPage.value
  // Shown page first so navigation stays responsive; the rest run afterward at low worker priority.
  const positions = order.map((_, position) => position)
  const shownAt = order.indexOf(page.value)
  if (shownAt > 0) {
    positions.splice(shownAt, 1)
    positions.unshift(shownAt)
  }
  const found: ImageWarning[] = []
  for (const position of positions) {
    const pageIndex = order[position]
    const pageGuideList = guides[pageIndex] ?? []
    if (pageGuideList.length === 0) continue
    const regions = pageGuideList.map((guide, i) => ({ id: String(i), rect: { ...guide.rect } }))
    let hits: string[]
    try {
      hits = await current.inspectRegions(pageIndex, opsOf(pageIndex), regions)
    } catch {
      if (doc.value !== current || token !== warningToken) return
      continue
    }
    if (doc.value !== current || token !== warningToken) return
    for (const id of hits) {
      const guide = pageGuideList[+id]
      if (!guide) continue
      found.push({
        id: `${pageIndex}-${id}`,
        page: pageIndex,
        pageNumber: position + 1,
        detail: warningDetail(guide.kind, guide.edge),
      })
    }
    // Publish partial results so the bar updates before all 20+ pages finish.
    imageWarnings.value = [...found].sort((a, b) => a.pageNumber - b.pageNumber || a.id.localeCompare(b.id))
  }
  if (token !== warningToken) return
  imageWarnings.value = found.sort((a, b) => a.pageNumber - b.pageNumber || a.id.localeCompare(b.id))
}

watch(
  [() => doc.value?.id, margins, guidesByPage, () => edits.ops.value, visiblePages],
  () => {
    if (!doc.value || !margins.value) {
      window.clearTimeout(warningTimer)
      warningToken++
      imageWarnings.value = []
      return
    }
    scheduleWarningScan()
  },
)

/** Selected editable annotation on the shown page (handles and tools visible). */
const activeAnnotation = ref<number | null>(null)
/** The open text popup for an editable annotation the host added. */
const annotationEditor = ref<{ id: number; text: RichText } | null>(null)

/**
 * Editable annotations the host added. They are not document edits: moving or editing them does not dirty
 * the document, and Apply does not draw them. The host burns them in with `burn-annotations`.
 */
const annotations = ref<Annotation[]>([])
let nextAnnotationId = 1

/** Page pixels per point, from the page's DPI. */
function pxPerPt(index: number): number {
  const info = pageInfos.value[index]
  return info ? pageResolution(info).dpiY / 72 : 1
}

const shownAnnotations = computed(() =>
  annotations.value.filter((a) => a.page === shownPage.value).map((a) => ({ ...a, pxPerPt: pxPerPt(a.page) })),
)

watch(shownPage, () => (activeAnnotation.value = null))
watch(annotations, (list) => {
  if (!list.some((a) => a.id === activeAnnotation.value)) activeAnnotation.value = null
})

function openAnnotationEditor(id: number) {
  const annotation = annotations.value.find((a) => a.id === id)
  if (!annotation) return
  annotationEditor.value = { id, text: annotation.text }
  activeAnnotation.value = id
}

function updateAnnotation(id: number, changes: Partial<Omit<Annotation, 'id' | 'page'>>) {
  annotations.value = annotations.value.map((annotation) => (annotation.id === id ? { ...annotation, ...changes } : annotation))
}

function saveAnnotation(text: RichText) {
  const editor = annotationEditor.value
  annotationEditor.value = null
  if (editor) updateAnnotation(editor.id, { text })
}

function removeAnnotation(id: number) {
  annotations.value = annotations.value.filter((annotation) => annotation.id !== id)
  if (annotationEditor.value?.id === id) annotationEditor.value = null
}

/**
 * The host's add-annotation: an Editable annotation replaces the one with the same name (the VerbiageStamp);
 * an Uneditable one is added. Shows its page and answers with an `annotation-result` event.
 */
function addHostAnnotation(command: Extract<HostCommand, { type: 'add-annotation' }>) {
  const reply = (status: 'Success' | 'Error', message: string, annotationId?: number) =>
    notifyHost({ type: 'annotation-result', requestId: command.requestId, status, message, annotationId })
  if (!doc.value || saving.value || hostLoading.value) {
    return reply('Error', !doc.value ? 'No document is open.' : hostLoading.value ? 'The image is still loading.' : 'The document is being saved.')
  }
  const kind = annotationKind(command.annotation)
  if (kind === 'invalid') return reply('Error', 'Bad request - type must be Editable or Uneditable.')
  if (kind === 'Uneditable') return addUneditableAnnotation(command.annotation as UneditableAnnotation, command, reply)
  const problem = legacyAnnotationProblem(command.annotation)
  if (problem) return reply('Error', `Bad request - ${problem}.`)
  const annotation = command.annotation as LegacyAnnotation
  const requested = legacyAnnotationPageIndex(annotation)
  const position = requested === null ? visiblePages.value.indexOf(shownPage.value) : requested
  const index = visiblePages.value[position]
  if (index === undefined) {
    const where = requested === null ? 'the current page' : `PageIndex ${annotation.PageIndex}`
    return reply('Error', `Bad request - ${where} is not a page (the document has ${visiblePages.value.length}).`)
  }
  const dpi = command.dpi ?? documentDpi.value ?? dpiRequirement()
  const name = legacyAnnotationName(annotation)
  const id = nextAnnotationId++
  const added: Annotation = {
    id,
    page: index,
    rect: legacyAnnotationRect(annotation, pageInfos.value[index], edits.rotations.value[index] ?? 0, dpi),
    text: legacyAnnotationText(annotation, dpi),
    name,
    border: legacyAnnotationBorder(annotation),
    requestId: command.requestId,
  }
  annotations.value = [...annotations.value.filter((item) => item.name !== name), added]
  goToPage(index)
  reply('Success', 'Add success', id)
}

/** An uneditable annotation from the host: its page (file index), box in page pixels and the object as sent. */
interface PlacedUneditableAnnotation {
  id: number
  page: number
  rect: ImageRect
  moved: boolean
  annotation: UneditableAnnotation
  dpiRequirement: number
  requestId: string | number | null
}

/** Uneditable annotations of the open document. Not edits (no undo, not dirty) until the host burns them in. */
const uneditableAnnotations = ref<PlacedUneditableAnnotation[]>([])

function addUneditableAnnotation(
  annotation: UneditableAnnotation,
  command: Extract<HostCommand, { type: 'add-annotation' }>,
  reply: (status: 'Success' | 'Error', message: string, id?: number) => void,
) {
  const problem = uneditableAnnotationProblem(annotation)
  if (problem) return reply('Error', `Bad request - ${problem}.`)
  const position = uneditableAnnotationPageIndex(annotation)
  const index = visiblePages.value[position]
  if (index === undefined) {
    return reply('Error', `Bad request - pageIndex ${position} is not a page (the document has ${visiblePages.value.length}).`)
  }
  const dpi = command.dpi ?? documentDpi.value ?? dpiRequirement()
  const rect = requirementRectToPage(uneditableAnnotationRect(annotation), pageInfos.value[index], edits.rotations.value[index] ?? 0, dpi)
  const id = nextAnnotationId++
  uneditableAnnotations.value = [
    ...uneditableAnnotations.value,
    { id, page: index, rect, moved: false, annotation: { ...annotation, type: 'Uneditable' }, dpiRequirement: dpi, requestId: command.requestId },
  ]
  goToPage(index)
  reply('Success', 'Add success', id)
}

const shownUneditableAnnotations = computed(() =>
  uneditableAnnotations.value
    .filter((item) => item.page === shownPage.value)
    .map(({ id, rect, annotation, dpiRequirement, page }) => {
      const { dpiX, dpiY } = pageResolution(pageInfos.value[page])
      const sideways = (edits.rotations.value[page] ?? 0) % 180 !== 0
      return { id, rect, annotation, applied: false, pagePxPerDpi: (sideways ? dpiX : dpiY) / dpiRequirement }
    }),
)

function moveUneditableAnnotation(id: number, rect: ImageRect) {
  uneditableAnnotations.value = uneditableAnnotations.value.map((item) => (item.id === id ? { ...item, rect, moved: true } : item))
}

/**
 * Takes one uneditable overlay off its page. The host passes the `annotationId` from `annotation-result`
 * and can call this once per annotation until none remain. It is not a document edit.
 */
function removeUneditableAnnotation(command: Extract<HostCommand, { type: 'remove-uneditable-annotation' }>) {
  const reply = (status: 'Success' | 'Error', message: string, annotationId?: number) =>
    notifyHost({
      type: 'uneditable-annotation-removed',
      requestId: command.requestId,
      status,
      message,
      ...(annotationId === undefined ? {} : { annotationId }),
      remaining: uneditableAnnotations.value.length,
    })
  if (!doc.value || saving.value || hostLoading.value) {
    return reply('Error', !doc.value ? 'No document is open.' : hostLoading.value ? 'The image is still loading.' : 'The document is being saved.')
  }
  if (command.annotationId === null) return reply('Error', 'Bad request - annotationId is not a number.')
  const item = uneditableAnnotations.value.find((entry) => entry.id === command.annotationId)
  if (!item) return reply('Error', 'That uneditable annotation is not on the page.', command.annotationId)
  uneditableAnnotations.value = uneditableAnnotations.value.filter((entry) => entry.id !== item.id)
  reply('Success', 'Remove success', item.id)
}

function clearAnnotations() {
  annotations.value = []
  uneditableAnnotations.value = []
  activeAnnotation.value = null
  annotationEditor.value = null
}

/** Page pixels per DPI-requirement pixel, matching the on-screen size of an uneditable annotation. */
function pagePxPerRequirement(page: number, dpi: number): number {
  const info = pageInfos.value[page]
  if (!info || dpi <= 0) return 1
  const { dpiX, dpiY } = pageResolution(info)
  const sideways = (edits.rotations.value[page] ?? 0) % 180 !== 0
  return (sideways ? dpiX : dpiY) / dpi
}

/**
 * Draws every annotation into its page (one undo step) and removes the overlays.
 * Apply later saves that drawing with the other edits; it does not burn annotations itself.
 */
function burnAnnotations(command: Extract<HostCommand, { type: 'burn-annotations' }>) {
  const reply = (status: 'Success' | 'Error', message: string, burned: BurnedAnnotation[] = []) =>
    notifyHost({ type: 'annotations-burned', requestId: command.requestId, status, message, annotations: burned })
  if (!doc.value || saving.value || hostLoading.value) {
    return reply('Error', !doc.value ? 'No document is open.' : hostLoading.value ? 'The image is still loading.' : 'The document is being saved.')
  }
  if (annotations.value.length === 0 && uneditableAnnotations.value.length === 0) {
    return reply('Error', 'There are no annotations to burn.')
  }
  const ops = new Map<number, PageOp[]>()
  const burned: BurnedAnnotation[] = []
  const add = (page: number, op: PageOp) => ops.set(page, [...(ops.get(page) ?? []), op])
  for (const annotation of annotations.value) {
    const rotation = edits.rotations.value[annotation.page] ?? 0
    add(annotation.page, annotationOp(annotation, rotation, pxPerPt(annotation.page)))
    burned.push({
      annotationId: annotation.id,
      type: 'Editable',
      requestId: annotation.requestId ?? null,
      pageIndex: Math.max(0, visiblePages.value.indexOf(annotation.page)),
    })
  }
  for (const item of uneditableAnnotations.value) {
    const info = pageInfos.value[item.page]
    const rotation = edits.rotations.value[item.page] ?? 0
    const scale = pagePxPerRequirement(item.page, item.dpiRequirement)
    add(item.page, uneditableAnnotationOp(item.annotation, item.rect, rotation, pxPerPt(item.page), scale))
    const position = Math.max(0, visiblePages.value.indexOf(item.page))
    const page = pageRectToRequirement({ x: 0, y: 0, width: info.width, height: info.height }, info, rotation, item.dpiRequirement)
    const placed = item.moved
      ? pageRectToRequirement(item.rect, info, rotation, item.dpiRequirement)
      : { x: item.annotation.left, y: item.annotation.top }
    burned.push({
      annotationId: item.id,
      type: 'Uneditable',
      requestId: item.requestId,
      pageIndex: position,
      annotation: placedUneditableAnnotation(item.annotation, placed.x, placed.y, position),
      pageSize: { width: page.width, height: page.height },
    })
  }
  edits.addOps(ops)
  clearAnnotations()
  reply('Success', `Burned ${burned.length} annotation${burned.length === 1 ? '' : 's'}.`, burned)
}

/** Apply is sending the new version to the server; the viewer is locked meanwhile. */
const saving = ref(false)
/** Host sent `image-loading`; busy until `open-image` / `image-missing` / `image-cleared`. */
const hostLoading = ref(false)
/** Empty-state copy when the host reported no image (`image-missing`); null = generic drop/open prompt. */
const hostEmptyMessage = ref<string | null>(null)
const NO_IMAGE_MESSAGE = 'No image found, please upload a new image.'

/** Commits pending toolbar edits in memory and notifies the host when the document has an id. */
async function commitAppliedEdits(id: string | null) {
  moveSession.value = null
  edits.apply()
  if (!id) return
  await nextTick()
  notifyHost({ type: 'document-saved', id })
}

/**
 * Commits the toolbar edits. Annotations stay overlays; the host burns those in separately.
 * A server document is saved first, as shown (like Download to PC as TIFF); if that fails, the edits stay pending.
 * When hosted, Apply emits `save-requested` and waits for `save-acked` / `save-failed` (host owns the API).
 */
async function applyEdits() {
  const current = doc.value
  const id = documentId.value
  if (!current || saving.value || hostLoading.value) return
  if (id) {
    saving.value = true
    showNotice('Saving…')
    try {
      const tiff = await current.exportFile(exportPages(), 'tiff')
      if (doc.value !== current) return
      if (isHosted()) {
        savingId.value = id
        notifyHost({ type: 'save-requested', id, name: current.name, buffer: await tiff.arrayBuffer() })
        // Host answers with save-acked / save-failed; keep Saving… until then.
        return
      }
      await saveDocument(id, tiff)
    } catch (err) {
      showNotice(null)
      saving.value = false
      if (doc.value === current) error.value = `Could not save: ${err instanceof Error ? err.message : String(err)}`
      return
    }
    if (doc.value !== current) {
      saving.value = false
      return
    }
    saving.value = false
    showNotice('Saved', NOTICE_MS)
  }
  await commitAppliedEdits(id)
}

function onSaveAcked(id: string) {
  if (!saving.value || savingId.value !== id) return
  saving.value = false
  savingId.value = null
  showNotice('Saved', NOTICE_MS)
  void commitAppliedEdits(id)
}

function onSaveFailed(id: string, message: string) {
  if (!saving.value || savingId.value !== id) return
  saving.value = false
  savingId.value = null
  showNotice(null)
  error.value = `Could not save: ${message}`
}

/** Host replaces the open document's key. Empty clears it. */
function onSetId(id: string | null) {
  if (!doc.value) return
  documentId.value = id
}

/** Replaces the open document's margin rules. Null clears the guides. Ignored while a new image is loading. */
function onSetMargins(spec: MarginSpec | null) {
  if (!doc.value || hostLoading.value) return
  margins.value = spec
}

watch(edits.hasChanges, (dirty) => notifyHost({ type: 'dirty-change', id: documentId.value, dirty }))

function opsOf(index: number): readonly PageOp[] {
  return edits.ops.value[index] ?? []
}

/** Arrow key nudge in reposition mode, in inches (Shift: ten times as far). */
const NUDGE_INCHES = 0.05

/**
 * Content moves on one page that the "move all pages?" question offers to copy: the page and how far its
 * content had been moved before the first of them. Ends when answered or when another page is shown.
 */
const moveSession = ref<{ page: number; start: PageShift } | null>(null)

/** Moves the shown page's content by `dx`, `dy` page pixels (unrotated page); one undo step. */
function repositionPage(dx: number, dy: number) {
  const index = shownPage.value
  if (!doc.value || edits.deleted.value[index] !== false) return
  if (moveSession.value?.page !== index) moveSession.value = { page: index, start: totalShift(opsOf(index)) }
  edits.setOps(new Map([[index, withShift(opsOf(index), dx, dy)]]))
}

/** Arrow keys in reposition mode: moves the content in that direction on screen. */
function nudgeContent(key: string, far: boolean) {
  const info = pageInfos.value[shownPage.value]
  if (!info) return
  const step = NUDGE_INCHES * (far ? 10 : 1)
  const inches = { x: ({ ArrowLeft: -1, ArrowRight: 1 }[key] ?? 0) * step, y: ({ ArrowUp: -1, ArrowDown: 1 }[key] ?? 0) * step }
  const { dx, dy } = screenInchesToShift(inches, info, shownRotation.value)
  repositionPage(dx, dy)
}

/** How far the shown page's content has been moved, as seen on screen (for the status bar). */
const shownShift = computed(() => {
  const info = pageInfos.value[shownPage.value]
  return info ? describeMove(shiftToScreenInches(totalShift(opsOf(shownPage.value)), info, shownRotation.value)) : ''
})

/** The move made in the current session, as seen on screen; null when there's nothing to offer. */
const sessionMove = computed(() => {
  const session = moveSession.value
  const info = session && pageInfos.value[session.page]
  if (!session || !info || visiblePages.value.length < 2) return null
  const now = totalShift(opsOf(session.page))
  const shift = { dx: now.dx - session.start.dx, dy: now.dy - session.start.dy }
  const inches = shiftToScreenInches(shift, info, edits.rotations.value[session.page] ?? 0)
  const description = describeMove(inches)
  return description ? { inches, description } : null
})

/** Moves the content of every other page the same distance and direction on screen, as one undo step. */
function moveAllPages() {
  const session = moveSession.value
  const move = sessionMove.value
  if (!session || !move) return
  const moves = new Map<number, PageOp[]>()
  for (const index of visiblePages.value) {
    if (index === session.page) continue
    const { dx, dy } = screenInchesToShift(move.inches, pageInfos.value[index], edits.rotations.value[index] ?? 0)
    if (dx || dy) moves.set(index, withShift(opsOf(index), dx, dy))
  }
  edits.setOps(moves)
  moveSession.value = null
  showNotice(`Moved ${moves.size} more ${moves.size === 1 ? 'page' : 'pages'} ${move.description}`, NOTICE_MS)
}

watch([shownPage, doc], () => (moveSession.value = null))

function cancelEdits() {
  moveSession.value = null
  revertEdits(edits.cancel)
}

// Re-render the current page in place when its edits change (new edit, undo, cancel).
watch(
  () => [page.value, opsKey(opsOf(page.value))] as const,
  ([index, key], [previousIndex, previousKey]) => {
    if (index === previousIndex && key !== previousKey) showPage(index)
  },
)

watch(areaSelection, (rect) => {
  if (!rect) areaPreviewFilter.value = null
})
const imageFilter = computed(() =>
  brightness.value === 100 && contrast.value === 100 ? 'none' : `brightness(${brightness.value}%) contrast(${contrast.value}%)`,
)

let loadToken = 0
let serverLoadToken = 0

/** Whether another document may replace the open one (asks when there are unapplied changes). */
function canReplaceDocument(): boolean {
  return !saving.value && !hostLoading.value && (!edits.hasChanges.value || window.confirm('Discard the changes you have not applied?'))
}

/** Opens a file from disk (no document id). */
async function openFile(file: File) {
  if (!canReplaceDocument()) return
  serverLoadToken++
  hostLoading.value = false
  hostEmptyMessage.value = null
  await openDocument(file, null)
}

/** Host: Loading while GetDocumentImage (then maybe GetDocumentTiff) runs. */
function onImageLoading(_id: string | null) {
  hostLoading.value = true
  hostEmptyMessage.value = null
  busy.value = true
  error.value = null
  showNotice(null)
}

/** Host finished GetDocumentTiff / upload: open the TIFF bytes it sent. */
async function openHostImage(command: Extract<HostCommand, { type: 'open-image' }>) {
  serverLoadToken++
  hostLoading.value = true
  hostEmptyMessage.value = null
  const file = new File([command.buffer], command.name.endsWith('.tif') || command.name.endsWith('.tiff') ? command.name : `${command.name}.tif`)
  const opened = await openDocument(file, command.id, {
    // Margins and DPI requirement come from the host, including null margins = none.
    margins: command.margins,
    dpiRequirement: command.dpiRequirement,
    skipConfirm: true,
  })
  hostLoading.value = false
  if (opened) notifyHost({ type: 'document-loaded', id: command.id })
}

/** GetDocumentImage said imageExists is false. */
function onImageMissing(_id: string | null) {
  resetViewerDocument()
  hostEmptyMessage.value = NO_IMAGE_MESSAGE
}

/** Host cancelled / cleared; generic empty state. */
function clearHostImage() {
  resetViewerDocument()
  hostEmptyMessage.value = null
}

/** Dispose the open document and leave the viewer empty (Loading already off). */
function resetViewerDocument() {
  serverLoadToken++
  loadToken++
  hostLoading.value = false
  clearAnnotations()
  doc.value?.dispose()
  doc.value = null
  documentId.value = null
  savingId.value = null
  margins.value = null
  documentDpi.value = null
  edits.reset(0)
  annotationEditor.value = null
  pageUrl.value = null
  zoomPercent.value = null
  page.value = 0
  shownPage.value = 0
  shownPageKey.value = ''
  moveSession.value = null
  busy.value = false
  error.value = null
  showNotice(null)
  notifyHost({ type: 'dirty-change', id: null, dirty: false })
}

/**
 * Loads a document by id via the viewer's stand-in fetch (dev / `?id=`). Prefer `open-image` when the
 * host supplies the bytes.
 */
async function loadServerDocument(id: string) {
  if (!canReplaceDocument()) return
  const token = ++serverLoadToken
  hostLoading.value = false
  busy.value = true
  error.value = null
  try {
    const document = await fetchDocument(id)
    if (token !== serverLoadToken) return
    const file = new File([document.file], document.name)
    if (await openDocument(file, document.id)) notifyHost({ type: 'document-loaded', id: document.id })
  } catch (err) {
    if (token !== serverLoadToken) return
    error.value = `Could not load document ${id}: ${err instanceof Error ? err.message : String(err)}`
    busy.value = false
  }
}

/**
 * Shows `file` (a TIFF, or a PDF converted first) in place of the open document; resolves to whether it was opened.
 * `margins` / `dpiRequirement` from the host replace stand-in loads when provided (including `null` margins = none).
 */
async function openDocument(
  file: File,
  id: string | null,
  options: { margins?: MarginSpec | null; dpiRequirement?: number | null; skipConfirm?: boolean } = {},
): Promise<boolean> {
  if (!options.skipConfirm && !canReplaceDocument()) return false
  const token = ++loadToken
  busy.value = true
  error.value = null
  try {
    const tiff = await asTiff(file, () => showNotice(`Converting ${file.name} to TIFF…`))
    if (token !== loadToken) return false
    if (tiff !== file) showNotice(null)
    const next = await TiffDocument.open(tiff)
    if (token !== loadToken) {
      next.dispose()
      return false
    }
    clearAnnotations()
    doc.value?.dispose()
    doc.value = next
    documentId.value = id
    documentDpi.value = options.dpiRequirement && options.dpiRequirement > 0 ? options.dpiRequirement : null
    if (options.margins !== undefined) {
      margins.value = options.margins
    } else {
      margins.value = null
      loadMargins(file.name)
        .then((spec) => {
          if (doc.value === next) margins.value = spec
        })
        .catch(() => {})
    }
    edits.reset(next.pageCount)
    annotationEditor.value = null
    selection.selectOnly(0)
    pageUrl.value = null
    zoomPercent.value = null
    moveSession.value = null
    await showPage(0)
    return true
  } catch (err) {
    if (token === loadToken) {
      showNotice(null)
      error.value = `Could not open "${file.name}": ${err instanceof Error ? err.message : String(err)}`
      busy.value = false
      hostLoading.value = false
    }
    return false
  }
}

async function showPage(index: number) {
  const current = doc.value
  if (!current || index < 0 || index >= current.pageCount) return
  const token = ++loadToken
  page.value = index
  busy.value = true
  error.value = null
  try {
    const ops = opsOf(index)
    const { width, height } = editedPageInfo(current.pages[index], ops)
    const url = await current.getPageUrl(index, ops)
    if (token !== loadToken) return
    shownPage.value = index
    shownPageKey.value = `${current.id}:${index}:${width}x${height}`
    pageUrl.value = url
    const next = visiblePages.value[visiblePages.value.indexOf(index) + 1]
    if (next !== undefined) current.getPageUrl(next, opsOf(next)).catch(() => {})
  } catch (err) {
    if (token === loadToken) error.value = `Could not render page ${index + 1}: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    if (token === loadToken) busy.value = false
  }
}

/** Navigation from anywhere except the thumbnails (toolbar, wheel, keyboard) selects just the new page. */
function goToPage(index: number) {
  if (edits.deleted.value[index] !== false) return
  selection.selectOnly(index)
  showPage(index)
}

/** `position` counts only pages that aren't deleted (0-based). */
function goToPosition(position: number) {
  const index = visiblePages.value[position]
  if (index !== undefined) goToPage(index)
}

/** Hides the selected pages (a pending edit, so Undo/Cancel bring them back) and moves to the page that followed them. */
function deleteSelectedPages() {
  const targets = selection.pages.value
  const firstPosition = visiblePages.value.findIndex((p) => selection.selected.value.has(p))
  const currentDeleted = targets.includes(page.value)
  if (!edits.deletePages(targets)) return
  const remaining = visiblePages.value
  goToPage(currentDeleted ? remaining[Math.min(firstPosition, remaining.length - 1)] : page.value)
}

/** Moves the selected pages one place up (-1) or down (+1); the selection and the shown page stay the same. */
function moveSelectedPages(direction: -1 | 1) {
  edits.movePages(selection.pages.value, direction)
}

/** Thumbnail drag & drop: moves `pages` before page `before` (null = the end). A dragged unselected page is shown. */
function onThumbnailMove(pages: number[], before: number | null) {
  if (!edits.movePagesBefore(pages, before)) return
  if (!pages.every((p) => selection.selected.value.has(p))) goToPage(pages[0])
}

/** Converts the selected pages (or all pages) to Letter/Legal; pages already that size are left alone. */
function convertPages(size: PaperSize, all: boolean) {
  const conversions = new Map<number, PageOp[]>()
  for (const index of all ? visiblePages.value : selection.pages.value) {
    const op = paperOp(pageInfos.value[index], size)
    if (op) conversions.set(index, [op])
  }
  edits.addOps(conversions)
}

/** Fills the margin bands and other areas (keep-clear boxes) of the selected pages (or all pages) with white. */
function whiteOutMargins(all: boolean) {
  const erases = new Map<number, PageOp[]>()
  for (const index of all ? visiblePages.value : selection.pages.value) {
    const areas = guidesByPage.value[index] ?? []
    erases.set(index, areas.map((guide): PageOp => ({ type: 'erase', rect: { ...guide.rect } })))
  }
  edits.addOps(erases)
}

/** Progress / result of a page tool (deskew, despeckle) shown in the status bar. */
const notice = ref<string | null>(null)
const deskewing = ref(false)
let noticeTimer: number | undefined
const NOTICE_MS = 4000

function showNotice(message: string | null, clearAfterMs?: number) {
  window.clearTimeout(noticeTimer)
  notice.value = message
  if (clearAfterMs) noticeTimer = window.setTimeout(() => (notice.value = null), clearAfterMs)
}

/**
 * Despeckles the selected pages (or all pages), each click one level more aggressive per page
 * (see DESPECKLE_LEVELS), as one undo step.
 */
function despecklePages(all: boolean) {
  const targets = all ? visiblePages.value : selection.pages.value
  const changes = new Map<number, PageOp[]>()
  let shownLevel = 0
  for (const index of targets) {
    const step = withDespeckleStep(opsOf(index), pageInfos.value[index])
    if (!step) continue
    changes.set(index, step.ops)
    if (index === page.value || !shownLevel) shownLevel = step.level
  }
  edits.setOps(changes)
  if (changes.size === 0) {
    showNotice('Despeckle is already at its strongest level', NOTICE_MS)
    return
  }
  const side = Math.sqrt(DESPECKLE_LEVELS[shownLevel - 1])
  const pages = targets.length > 1 ? ` on ${changes.size} pages` : ''
  showNotice(`Despeckle level ${shownLevel} of ${DESPECKLE_LEVELS.length}${pages}: specks up to ${side}×${side} px removed`, NOTICE_MS)
}

/** Measures the skew of the selected pages (or all pages) and straightens those that need it, as one undo step. */
async function deskewPages(all: boolean) {
  const current = doc.value
  if (!current || deskewing.value) return
  const targets = [...(all ? visiblePages.value : selection.pages.value)]
  deskewing.value = true
  showNotice(targets.length > 1 ? `Measuring skew of ${targets.length} pages…` : 'Measuring skew…')
  try {
    const angles = await Promise.all(targets.map((index) => current.measureSkew(index, opsOf(index))))
    if (doc.value !== current) return
    const deskews = new Map<number, PageOp[]>()
    targets.forEach((index, i) => {
      if (angles[i]) deskews.set(index, [{ type: 'deskew', angle: angles[i] }])
    })
    edits.addOps(deskews)
    if (deskews.size === 0) showNotice('No skew found', NOTICE_MS)
    else if (targets.length === 1) showNotice(`Deskewed by ${Math.abs(angles[0])}°`, NOTICE_MS)
    else showNotice(`Deskewed ${deskews.size} of ${targets.length} pages`, NOTICE_MS)
  } catch (err) {
    showNotice(null)
    if (doc.value === current) error.value = `Could not deskew: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    deskewing.value = false
  }
}

const downloadDialogOpen = ref(false)
const downloading = ref(false)

/** File name suggested in the download dialog: the open file's name without its extension. */
const downloadName = computed(() => (doc.value?.name ?? 'document').replace(/\.[^.]+$/, ''))

/**
 * The document as shown, for writing a file: visible pages in display order, with their rotations and edits
 * (pending ones included, as they'd be after Apply). Annotations are included only once the host has burned them in.
 */
function exportPages(): ExportPage[] {
  return visiblePages.value.map((index) => ({
    page: index,
    ops: opsOf(index),
    rotation: edits.rotations.value[index] ?? 0,
    ...pageResolution(pageInfos.value[index]),
  }))
}

async function downloadDocument(fileName: string, format: ExportFormat) {
  downloadDialogOpen.value = false
  const current = doc.value
  if (!current || downloading.value) return
  downloading.value = true
  showNotice(`Preparing ${fileName}…`)
  try {
    const blob = await current.exportFile(exportPages(), format)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    showNotice(`Downloaded ${fileName} (${(blob.size / 1e6).toFixed(1)} MB)`, NOTICE_MS)
  } catch (err) {
    showNotice(null)
    if (doc.value === current) error.value = `Could not download: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    downloading.value = false
  }
}

/**
 * Adds the pages of `file` (a TIFF, or a PDF converted first) to the document above the topmost selected page
 * (pending: Undo / Cancel take them out). `source` names where they came from in the messages.
 */
async function insertPagesFromFile(file: File, source = file.name) {
  const current = doc.value
  if (!current) return
  const before = visiblePages.value.find((index) => selection.selected.value.has(index)) ?? page.value
  showNotice(`Inserting pages from ${source}…`)
  try {
    const tiff = await asTiff(file, () => showNotice(`Converting ${source} to TIFF…`))
    if (doc.value !== current) return
    const { first, count } = await current.addFile(tiff)
    if (doc.value !== current) return
    triggerRef(doc)
    edits.insertPages(Array.from({ length: count }, (_, i) => first + i), before)
    goToPage(first)
    showNotice(`Inserted ${count} ${count === 1 ? 'page' : 'pages'} from ${source}`, NOTICE_MS)
  } catch (err) {
    showNotice(null)
    if (doc.value === current) error.value = `Could not insert pages from ${source}: ${err instanceof Error ? err.message : String(err)}`
  }
}

const scanning = ref(false)

/** Scans pages with Dynamic Web TWAIN (source dialog, then the scanner's dialog) and inserts them like a file. */
async function scanPages() {
  const current = doc.value
  if (!current || scanning.value || !canScan.value) return
  scanning.value = true
  showNotice('Connecting to the scanner…')
  try {
    const { scanToTiff } = await import('./scan/scanner')
    showNotice('Scanning…')
    const tiff = await scanToTiff()
    if (doc.value !== current) return
    if (!tiff) {
      showNotice('Scan cancelled', NOTICE_MS)
      return
    }
    await insertPagesFromFile(new File([tiff], 'Scan.tif', { type: 'image/tiff' }), 'the scanner')
  } catch (err) {
    showNotice(null)
    if (doc.value === current) error.value = `Could not scan: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    scanning.value = false
  }
}

/** Undo/Cancel; if that restores deleted pages, show the first of them so the user sees it come back. */
function revertEdits(action: () => void) {
  const before = edits.deleted.value
  const visibleBefore = visiblePages.value
  action()
  const restored = edits.deleted.value.findIndex((isDeleted, i) => before[i] && !isDeleted)
  if (restored >= 0) {
    goToPage(restored)
  } else if (edits.deleted.value[page.value]) {
    // The shown page was taken out again (an inserted page): show the page that followed it.
    const visible = new Set(visiblePages.value)
    const following = visibleBefore.slice(visibleBefore.indexOf(page.value)).find((index) => visible.has(index))
    goToPage(following ?? visiblePages.value[visiblePages.value.length - 1])
  }
  // Rotate all → Cancel undoes the angle; re-apply the sticky fit after the rotation prop has flushed.
  const mode = fitMode.value
  if (mode) void nextTick(() => viewer.value?.fit(mode))
}

function onThumbnailSelect(index: number, modifiers: { ctrl: boolean; shift: boolean }) {
  if (modifiers.shift) {
    selection.selectRange(index, modifiers.ctrl)
    showPage(index)
  } else if (modifiers.ctrl) {
    if (selection.toggle(index)) showPage(index)
  } else {
    goToPage(index)
  }
}

function fit(mode: FitMode) {
  fitMode.value = mode
  viewer.value?.fit(mode)
}

/** Manual zooming leaves fit mode, so the zoom level is kept across rotations. */
function zoom(action: (target: InstanceType<typeof OsdViewer>) => void) {
  fitMode.value = null
  if (viewer.value) action(viewer.value)
}

/** Records a pixel edit on the selected area of the displayed page (kept selected for further edits). */
function editArea(makeOp: (rect: ImageRect) => PageOp) {
  const rect = areaSelection.value
  if (!rect) return
  edits.addOp(shownPage.value, makeOp({ ...rect }))
}

const eraseArea = () => editArea((rect) => ({ type: 'erase', rect }))
const despeckleArea = () => editArea((rect) => ({ type: 'despeckle', rect, maxSize: DEFAULT_SPECK_SIZE }))
const adjustArea = (type: 'contrast' | 'brightness', amount: number) => editArea((rect) => ({ type, rect, amount }))

async function print() {
  const current = doc.value
  if (!current) return
  busy.value = true
  error.value = null
  try {
    await printDocument(current, visiblePages.value, edits.rotations.value, edits.ops.value)
  } catch (err) {
    error.value = `Could not print: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    busy.value = false
  }
}

/** Only files show the drop overlay (thumbnail drags are handled by the sidebar). */
function onDragOver(event: DragEvent) {
  if (!event.dataTransfer?.types.includes('Files')) return
  event.preventDefault()
  dragging.value = true
}

async function onDrop(event: DragEvent) {
  dragging.value = false
  const file = event.dataTransfer?.files[0]
  if (!file) return
  // A host owns loading: hand it the dropped file so its API (not the viewer's own open) replaces the image.
  if (isHosted()) {
    try {
      notifyHost({ type: 'file-dropped', name: file.name, buffer: await file.arrayBuffer() })
    } catch (err) {
      error.value = `Could not send the dropped file: ${err instanceof Error ? err.message : String(err)}`
    }
    return
  }
  openFile(file)
}

function onKeydown(event: KeyboardEvent) {
  const target = event.target
  if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, select, textarea'))) return
  if (annotationEditor.value || downloadDialogOpen.value || saving.value || hostLoading.value) return
  if (activeAnnotation.value !== null && (event.key === 'Escape' || event.key === 'Delete' || event.key === 'Backspace')) {
    event.preventDefault()
    if (event.key === 'Escape') activeAnnotation.value = null
    else removeAnnotation(activeAnnotation.value)
  } else if (event.key === 'Escape' && eraseMode.value) {
    eraseMode.value = false
  } else if (event.key === 'Escape' && repositionMode.value) {
    repositionMode.value = false
  } else if (repositionMode.value && event.key.startsWith('Arrow') && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault()
    nudgeContent(event.key, event.shiftKey)
  } else if (event.key === 'Escape' && selectAreaMode.value) {
    if (areaSelection.value) areaSelection.value = null
    else selectAreaMode.value = false
  } else if ((event.key === 'Delete' || event.key === 'Backspace') && areaSelection.value) {
    event.preventDefault()
    eraseArea()
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    revertEdits(edits.undo)
  } else if (event.key === 'PageDown') {
    event.preventDefault()
    goToPosition(pagePosition.value + 1)
  } else if (event.key === 'PageUp') {
    event.preventDefault()
    goToPosition(pagePosition.value - 1)
  }
}

let stopListeningToHost = () => {}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  stopListeningToHost = listenToHost((command) => {
    switch (command.type) {
      case 'image-loading':
        onImageLoading(command.id)
        break
      case 'open-image':
        void openHostImage(command)
        break
      case 'image-missing':
        onImageMissing(command.id)
        break
      case 'image-cleared':
        clearHostImage()
        break
      case 'save-acked':
        onSaveAcked(command.id)
        break
      case 'save-failed':
        onSaveFailed(command.id, command.message)
        break
      case 'load-document':
        void loadServerDocument(command.id)
        break
      case 'add-annotation':
        addHostAnnotation(command)
        break
      case 'burn-annotations':
        burnAnnotations(command)
        break
      case 'remove-uneditable-annotation':
        removeUneditableAnnotation(command)
        break
      case 'set-id':
        onSetId(command.id)
        break
      case 'set-icons':
        setIcons(command.icons)
        break
      case 'set-scan-license':
        setScanLicense(command.productKey)
        break
      case 'set-dpi-requirement':
        setDpiRequirement(command.dpiRequirement)
        break
      case 'set-margins':
        onSetMargins(command.margins)
        break
    }
  })
  // Standalone: `?id=` still self-fetches. A host should open with `open-image` instead.
  const id = initialDocumentId()
  if (id && !isHosted()) void loadServerDocument(id)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  stopListeningToHost()
  window.clearTimeout(noticeTimer)
  window.clearTimeout(warningTimer)
  doc.value?.dispose()
})
</script>

<template>
  <div
    class="app"
    @dragover="onDragOver"
    @dragleave.self="dragging = false"
    @drop.prevent="onDrop"
  >
    <ViewerToolbar
      v-model:brightness="brightness"
      v-model:contrast="contrast"
      :page="pagePosition"
      :page-count="doc ? visiblePages.length : 0"
      :busy="busy"
      :thumbnails-visible="thumbnailsVisible"
      :can-undo="edits.canUndo.value"
      :has-changes="edits.hasChanges.value"
      :saves-to-server="documentId !== null"
      :fit-mode="fitMode"
      :zoom-percent="zoomPercent"
      :selected-count="selection.count.value"
      :select-area-active="selectAreaMode"
      :erase-active="eraseMode"
      :reposition-active="repositionMode"
      :can-delete-pages="canDeletePages"
      :can-move-up="canMoveUp"
      :can-move-down="canMoveDown"
      :has-margins="!!margins"
      :deskewing="deskewing"
      :downloading="downloading"
      :scanning="scanning"
      :can-scan="canScan"
      @insert-file="(file: File) => insertPagesFromFile(file)"
      @scan="scanPages"
      @download="downloadDialogOpen = true"
      @delete-pages="deleteSelectedPages"
      @move-pages="moveSelectedPages"
      @toggle-erase="toggleEraseMode"
      @toggle-reposition="toggleRepositionMode"
      @despeckle-pages="despecklePages"
      @toggle-select-area="toggleSelectAreaMode"
      @toggle-thumbnails="thumbnailsVisible = !thumbnailsVisible"
      @undo="revertEdits(edits.undo)"
      @print="print"
      @rotate-page="(degrees: number) => edits.rotatePages(selection.pages.value, degrees)"
      @rotate-all="(degrees: number) => edits.rotateAll(degrees)"
      @apply="applyEdits"
      @scale-pages="(step: number, all: boolean) => edits.scalePages(all ? visiblePages : selection.pages.value, step)"
      @cancel="cancelEdits"
      @convert-pages="convertPages"
      @white-out-margins="whiteOutMargins"
      @deskew-pages="deskewPages"
      @fit="fit"
      @go-to-page="goToPosition"
      @zoom-in="zoom((v) => v.zoomIn())"
      @zoom-out="zoom((v) => v.zoomOut())"
      @set-zoom="(percent: number) => zoom((v) => v.setZoomPercent(percent))"
    />

    <ImageWarnings :warnings="imageWarnings" @select="goToPage" />

    <div class="body">
      <ThumbnailSidebar
        v-if="doc && thumbnailsVisible"
        :key="doc.id"
        :doc="doc"
        :page="page"
        :pages="visiblePages"
        :rotations="edits.rotations.value"
        :ops="edits.ops.value"
        :page-infos="pageInfos"
        :guides="guidesByPage"
        :warning-pages="warningPages"
        :selected="selection.selected.value"
        :deleted-count="edits.deletedCount.value"
        @select="onThumbnailSelect"
        @select-all="selection.selectAll()"
        @clear-selection="selection.selectOnly(page)"
        @move="onThumbnailMove"
      />

      <main class="stage">
        <OsdViewer
          ref="viewer"
          :url="pageUrl"
          :page-key="shownPageKey"
          :rotation="shownRotation"
          :fit-mode="fitMode"
          :image-filter="imageFilter"
          :select-mode="selectAreaMode"
          :erase-mode="eraseMode"
          :reposition-mode="repositionMode"
          :selection-filter="areaPreviewFilter"
          :guides="pageGuides"
          :annotations="shownAnnotations"
          :active-annotation="activeAnnotation"
          :uneditable-annotations="shownUneditableAnnotations"
          v-model:selection="areaSelection"
          @uneditable-annotation-move="moveUneditableAnnotation"
          @annotation-select="(id: number | null) => (activeAnnotation = id)"
          @annotation-change="(id: number, rect: Annotation['rect']) => updateAnnotation(id, { rect })"
          @annotation-edit="openAnnotationEditor"
          @annotation-remove="removeAnnotation"
          @open-failed="(msg: string) => (error = msg)"
          @zoom-change="(percent: number) => (zoomPercent = percent)"
          @page-scroll="(direction: number) => goToPosition(pagePosition + direction)"
          @user-zoom="fitMode = null"
          @erase-area="(rect: ImageRect) => edits.addOp(shownPage, { type: 'erase', rect })"
          @reposition="repositionPage"
        >
          <template #selection-actions>
            <AreaActions
              @adjust="adjustArea"
              @despeckle="despeckleArea"
              @erase="eraseArea"
              @clear="areaSelection = null"
              @preview-filter="(filter: string | null) => (areaPreviewFilter = filter)"
            />
          </template>
        </OsdViewer>

        <div v-if="!doc && !busy && !hostLoading" class="empty">
          <template v-if="hostEmptyMessage">
            <p>{{ hostEmptyMessage }}</p>
          </template>
          <template v-else>
            <p>Waiting for the host to open a document</p>
            <p class="hint">
              {{
                isHosted()
                  ? 'Drop a TIFF or PDF here.'
                  : 'Drop a TIFF or PDF here to preview locally; PDFs are converted to TIFF.'
              }}
            </p>
          </template>
        </div>

        <AnnotationEditor
          v-if="annotationEditor"
          :key="annotationEditor.id"
          :text="annotationEditor.text"
          :is-new="false"
          @save="saveAnnotation"
          @cancel="annotationEditor = null"
          @remove="removeAnnotation(annotationEditor.id)"
        />

        <DownloadDialog
          v-if="downloadDialogOpen && doc"
          :default-name="downloadName"
          :page-count="visiblePages.length"
          @download="downloadDocument"
          @cancel="downloadDialogOpen = false"
        />

        <MoveAllPrompt
          v-if="sessionMove"
          class="move-all"
          :move="sessionMove.description"
          :other-pages="visiblePages.length - 1"
          @all="moveAllPages"
          @dismiss="moveSession = null"
        />

        <div v-if="dragging" class="drop-overlay">Drop to open</div>
        <div v-if="error" class="error" role="alert">
          {{ error }}
          <button type="button" @click="error = null">×</button>
        </div>
      </main>
    </div>

    <footer v-if="displayedPageSize" class="status">
      <span v-if="doc" class="status-file" :title="doc.name">{{ doc.name }}</span>
      {{ displayedPageSize.width }} × {{ displayedPageSize.height }} px
      <span v-if="displayedPageSize" class="status-inches">({{ displayedPageSize.inches }})</span>
      <span v-if="areaSelection" class="status-selection">
        Selection: {{ areaSelection.width }} × {{ areaSelection.height }} px at ({{ areaSelection.x }}, {{ areaSelection.y }})
      </span>
      <span v-else-if="selectAreaMode" class="status-selection">Drag on the page to select an area</span>
      <span v-else-if="eraseMode" class="status-selection">Drag a rectangle on the page to erase it (Esc to stop erasing)</span>
      <span v-else-if="repositionMode" class="status-selection">
        Drag the page content to move it; arrow keys nudge it (Shift = further). Esc to stop
      </span>
      <span v-if="shownShift" class="status-selection">Content moved {{ shownShift }}</span>
      <span v-if="notice" class="status-selection">{{ notice }}</span>
    </footer>

    <div v-if="saving || hostLoading" class="saving-overlay" role="status">
      <AppIcon name="spinner" spin />
      {{ saving ? 'Saving…' : 'Loading…' }}
    </div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.stage {
  position: relative;
  flex: 1;
  min-width: 0;
  background: #5a5a5a;
}

.empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 1.5rem;
  pointer-events: none;
  text-align: center;
  background: #e7eef8;
  color: #1d2635;
}

.empty p {
  margin: 0;
}

.empty .hint {
  color: #5c6b80;
  font-size: 0.9em;
}

.move-all {
  position: absolute;
  bottom: 24px;
  left: 50%;
  z-index: 5;
  transform: translateX(-50%);
}

.drop-overlay {
  position: absolute;
  inset: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed #2f6fd1;
  border-radius: 8px;
  background: rgb(232 240 252 / 92%);
  color: #1f3a68;
  font-size: 1.25rem;
  pointer-events: none;
}

.error {
  position: absolute;
  top: 1rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 0.75rem;
  max-width: 80%;
  padding: 0.6rem 0.9rem;
  border-radius: 6px;
  background: #8b2d2d;
  color: #fff;
}

.error button {
  border: none;
  background: none;
  color: inherit;
  font-size: 1.1rem;
  cursor: pointer;
}

.saving-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  background: rgb(0 0 0 / 35%);
  color: #fff;
  font-size: 1.25rem;
  cursor: wait;
}

.status-inches {
  margin-left: 0.35rem;
}

.status-selection {
  margin-left: 1.5rem;
  color: #2f6fd1;
}

.status-file {
  display: inline-block;
  max-width: 24rem;
  margin-right: 1.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
  font-weight: 600;
}

.status {
  padding: 0.25rem 0.75rem;
  background: #f4f6f9;
  border-top: 1px solid #c9d1dd;
  font-size: 0.85em;
  opacity: 0.85;
}
</style>
