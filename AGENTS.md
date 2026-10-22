# TIFF Image Viewer

Browser-based viewer for single and multipage TIFF files, built on OpenSeadragon. Everything runs client-side; there is no backend of its own: a hosting app embeds the viewer and supplies documents (see "Hosting app and server documents").

## Tech stack

- Vue 3 (Composition API, `<script setup lang="ts">`), TypeScript in strict mode
- Vite 6 (dev server, build, ES module web workers)
- OpenSeadragon 5 (`openseadragon`, typed via `@types/openseadragon`)
- `utif` for TIFF parsing/decoding (typed via our own `src/types/utif.d.ts`)
- `dwt` 17.3 (Dynamsoft Dynamic Web TWAIN) for scanning; ships its own types. Pinned to 17.x (`~17.3.5`); don't upgrade the major version without a licence that covers it. Loaded lazily on the first scan. The scan button is hidden until a product key is set (`src/scan/license.ts`, `canScan`). A company supplies its own key: `VITE_DWT_PRODUCT_KEY` at build time (`.env.local`, gitignored), `window.tiffViewerScanLicense` before the app script, or the host command `set-scan-license` (`productKey`; `null` or `''` hides the button again). The key is not sent back in any event. Also needs:
  - the Dynamsoft Service on the user's PC (DWT offers the installer itself when it's missing);
  - its resource folder (CSS, wasm, helper scripts, service installers, ~115 MB) at `ResourcesPath`: the `dwt-resources` plugin in `vite.config.ts` serves `node_modules/dwt/dist` at `/dwt-resources` in dev and copies its `src/`, `dist/` and the camera addon CSS (loaded on start) into `dist/dwt-resources` on build (the rest of `addon/`, OCR / barcode, isn't needed); `VITE_DWT_RESOURCES_PATH` points elsewhere (e.g. a CDN).
- Icons are built-in SVGs (`src/icons/icons.ts`, drawn by `AppIcon.vue`; `currentColor`, so they follow the toolbar color). A company replaces any icon by its name (`sidebar`, `print`, `trash`, … — the keys of `ICONS`): set `window.tiffViewerIcons` before the app script, or send the host command `set-icons`. A value is an image URL (`https:`, a site path, or `data:image/…`), one `<svg>` element, or one Font Awesome `<i class="fa-solid fa-print">` tag; `null` or `''` restores the built-in. SVG and `<i>` overrides are sanitized (scripts and event handlers dropped; an `<i>` keeps its class only). Unknown names are ignored. An `<i>` needs the company's Font Awesome CSS or kit in the viewer: `window.tiffViewerIconFont` before the app script, or `iconFont` on `set-icons` (a `.js` URL is the kit script, anything else is a stylesheet; `null` removes it). The host page's own Font Awesome does not apply inside the iframe.
- No UI framework, router, or state library. Plain scoped CSS.

`package.json` is the source of truth for versions. When adding or removing a dependency, update this file in the same change.

## Commands

- `npm run dev`: dev server at http://localhost:5173. `examples/host.html` is a sample host (left 40% loads `samples/` and posts `open-image`; the viewer iframe is the right 60%). `examples/tabs.html` hosts three viewers in tabs on the right (each iframe has its own `?viewerId=`); the left 40% shows that tab's host controls. A fourth tab, Add Image, opens an empty viewer until a sample or Upload Image is chosen. Once that viewer has an image the button says Replace Image. Both pages upload a PDF or TIFF: `window.tiffHostLoadImage` (`examples/loadImage.js`), if set, loads that file from the company's API and returns TIFF bytes; otherwise a TIFF is sent as-is and a PDF goes through the local `asTiff` stand-in. These pages only work in local dev (they read `samples/`)
- `npm run build`: typecheck (`vue-tsc`) + production build. Run this before calling a change done.
- `npm run samples`: generate test TIFFs into `samples/` (gitignored): `single-page.tif`, `multi-page.tif` (5 pages plus a reduced-resolution IFD that must be skipped), `speckled.tif` (2 white "scanned" pages with ruled lines, 5×5 dots and random 1–3 px specks, for despeckle) and `skewed.tif` (3 text-like pages tilted 2.5° clockwise, 1.5° counter-clockwise and 0°, for deskew); all at 200 dpi. `samples/margins.json` is hand-written test data for the margins feature (not generated)
- `npm run deploy`: production build, prepare for Cloudflare Pages (`prepare-pages`: drop files over Pages' 25 MiB limit — the Dynamsoft Service `.msi` / `.pkg` installers), then `wrangler pages deploy`. Needs `npx wrangler login` once. Project name: `tiff-image-viewer` (`wrangler.toml`). The CDN build does not include `samples/`, so the stand-in `fetchDocument` / `loadMargins` APIs only work in local `npm run dev`. Without a Dynamsoft product key the scan button is omitted; a key can be baked in with `VITE_DWT_PRODUCT_KEY` or sent at runtime (`set-scan-license`).

## Architecture

```
App.vue                  state: open document (and its id), current page, fit mode, zoom %, brightness/contrast, errors,
                         drag & drop, keyboard; reports dirty state to the host; Apply → save-requested when hosted
├─ ViewerToolbar.vue     two-row toolbar (emits only); compact page / zoom boxes
│                        so both rows fit from ~880 px wide (the file name is in App's status bar, not here)
│  ├─ ToolButton.vue     icon button (`icon` is an `IconName`); `large` = "all pages" variant, `placeholder` = shown but disabled
│  └─ ImageAdjustments.vue  brightness/contrast popover (view-only CSS filter)
├─ ThumbnailSidebar.vue  lazy thumbnails via IntersectionObserver; keyed by document id; lists only visible pages
│                        (numbered by position); shows pending rotations and margin guides (as % of the page,
│                        inside the rotated wrapper)
│                        and pixel edits (reloads a loaded thumbnail when its page's ops change); drag & drop
│                        reordering (HTML5 drag, emits move(pages, before))
└─ OsdViewer.vue         the only component that touches OpenSeadragon; props url/pageKey/rotation/fitMode/imageFilter/
   │                     selectMode/eraseMode/repositionMode/selectionFilter/guides, v-model selection; exposes
   │                     zoomIn/zoomOut/fit/setZoomPercent; in repositionMode a drag moves a copy of the page image
   │                     (clipped to the page, on white) as a live preview and emits reposition(dx, dy) on release;
   │                     draws `guides` (margins / keep-clear areas) teleported into OSD's canvas element;
   │                     emits zoom-change (image zoom in %). A new url with the same pageKey (an edit of the shown page)
   │                     is swapped in place, keeping zoom/pan and the area selection; a new pageKey opens a fresh page.
   │                     App's pageKey includes the edited page size, so a paper-size conversion reopens (and re-fits).
│                     Also lays out the shown page's host `annotations` (teleported next to the guides) and turns
│                     drags into page-pixel moves/resizes (emits annotation-select/-change/-edit/-remove); exposes viewCenter.
│                     `annotationsLocked` shows them but ignores the mouse. Same for the shown page's
│                     uneditable annotations (move only, emits uneditable-annotation-move at the end of a drag).
   │                     Sizes a `.canvas-container` to the displayed page (image scaled into it; black border);
   │                     the stage (`.osd-wrap`) scrolls when the page is taller or wider than the view.
   ├─ AnnotationBox.vue  one pending annotation on screen (rich text, dashed outline; when active: resize handle,
   │                     edit / delete tools). Positions come from OsdViewer; it only emits presses
├─ UneditableAnnotationBox.vue one uneditable annotation on screen, styled from the host's object (fill, font,
│                     text, stroke, opacity); only emits press-move
   └─ AreaActions.vue    (slot `selection-actions`) popover under the selected area (kept inside the viewer):
                         Brightness / Contrast (one slider at a time, live CSS backdrop-filter preview), Despeckle,
                         Erase, clear selection
AnnotationEditor.vue     rich text popup (contenteditable + execCommand: bold / italic / underline, size in pt, color,
                         alignment) over the viewer; reads the result back with richTextFromElement
DownloadDialog.vue       Download to PC popup: file name + type (PDF / TIFF); emits download(fileName, format)
MoveAllPrompt.vue        "Move all pages the same way?" bar after a reposition; emits all / dismiss

src/annotations/richText.ts      RichText model (paragraphs of styled runs, sizes in pt), HTML for the editor, DOM -> model
                                 (computed styles, so any markup works), CSS for runs. Text is never stored as HTML
src/annotations/drawRichText.ts  canvas layout/drawing of RichText (word wrap, alignment, underline) used by the worker;
                                 mirrors the overlay's CSS (Arial, line-height 1.2, pre-wrap) so applied text matches
src/annotations/annotation.ts    Annotation { id, page, rect, text, name?, border? } and annotationOp (-> TextOp when the host burns it in);
                                 VERBIAGE_STAMP
src/composables/usePageEdits.ts  pending page edits (rotation, ops and deleted flag per page, page order;
                                 visiblePages, deletedCount) with undo history, apply, cancel, insertPages (grows every
                                 state for pages added to the document); movePagesWithin / movePagesBefore (pure move
                                 logic: one place up / down, or to a drop position)
src/composables/usePageSelection.ts  multi-page selection from the thumbnails (click / Ctrl / Shift / Ctrl+A)
src/print/printDocument.ts       prints the visible pages (rotations and pixel ops applied) through a hidden iframe
src/scan/scanner.ts              the only module that imports `dwt`: scanToTiff() connects to the DWT service, shows
                                 Dynamsoft's source dialog, scans with the driver UI, returns the pages as one TIFF blob
src/export/                      file writers used by the worker for Download to PC: encodedPage.ts (pixels -> gray/RGB
                                 samples, zlib), tiffFile.ts (multi-page TIFF), pdfFile.ts (PDF of page images)
src/margins/margins.ts           MarginSpec (API shape: firstPage / lastPage / defaultPage, inches, otherAreas) and
                                 marginGuides(): rules for one page -> PageGuide rects in page pixels (uses page DPI)
src/margins/loadMargins.ts       stand-in for the margins API: fetches samples/margins.json (dev server only)
src/api/documentApi.ts           stand-in for the document API: fetchDocument(id) (reads samples/<id>.tif, else .pdf;
                                 dev server only) and saveDocument(id, tiff) (logs to the console)
src/api/asTiff.ts                fileKind (TIFF / PDF by magic bytes) and asTiff(file): TIFF as is, PDF -> convertPdfToTiff,
                                 anything else rejected. Every opened or inserted file goes through it
src/api/pdfToTiff.ts             stand-in for the PDF -> TIFF conversion API: one labelled blank Letter page per PDF page
                                 (pages counted by regex), written with src/export
src/host/actionBrand.ts          Apply / Cancel label and colors (set-actions, window.tiffViewerActions)
src/host/hostBridge.ts           messages to / from the hosting app: notifyHost (events), listenToHost (commands),
                                 isHosted, initialDocumentId (?id= stand-alone only; ?docId= still accepted)
src/host/legacyAnnotation.ts     the old viewer's annotation object (AddAnnotation) -> Annotation: validation, RichText,
                                 rect (via requirementRectToPage), border
src/host/dpiRequirement.ts       DPI requirement (company assertion, default 300) and its pixels on the displayed page
                                 <-> unrotated page pixels (requirementRectToPage, clamped to the page;
                                 pageRectToRequirement)
src/host/uneditableAnnotation.ts UneditableAnnotation (host object, type 'Uneditable'; stampType 'UneditableAnnotation'
                                 and 'FillInStamp' still accepted): annotationKind, validation, page / requirement rect,
                                 uneditableAnnotationOp (burn-in), placedUneditableAnnotation, uneditableAnnotationStyle (CSS)
src/viewer/pageGuide.ts          PageGuide: { kind: 'margin' | 'keep-clear', edge?, rect } drawn over the page
src/warnings/imageWarning.ts     ImageWarning { id, page, pageNumber, detail }; warningDetail / warningMessage for the bar
src/host/allowedPageSize.ts      Allowed page size from the host (LETTER / LEGAL / LETTERLEGAL / ANY) and its inch threshold;
                                 pageMatchesAllowedSize, pageSizeWarningDetail
ImageWarnings.vue                expandable strip under the toolbar: "N image warnings" + list ("Page 1 overlaps the right margin"); click goes to that page
src/viewer/fitMode.ts            FitMode type: page (Best Fit) | width (Fit Width) | actual (Full Size, 100%); DEFAULT_FIT_MODE (width)
src/viewer/imageRect.ts          ImageRect: rectangle in page pixels; unrotateRect / unrotateDelta (displayed page ->
                                 unrotated page pixels), rotateRect (the inverse)
src/viewer/contentShift.ts       content moves (reposition): totalShift (sum of a page's shift ops), page pixels <->
                                 on-screen inches for a page's DPI and rotation, describeMove (`0.50" right, 0.91" down`)
src/viewer/useAreaSelection.ts   rubber-band area selection over OpenSeadragon (draw / move / resize; optional onDrawEnd,
                                 used by the erase tool)

src/tiff/
├─ TiffDocument.ts       main-thread API for one open file; owns the worker; caches blob URLs per (page, ops) version
│                        (max 3 versions per page, evicted versions revoked), revokes everything on dispose();
│                        measureSkew (page skew in degrees); addFile appends another file's pages (inserted pages)
├─ tiff.worker.ts        decodes with utif (LRU of 2 decoded pages), applies ops, renders pages/thumbnails to PNG blobs,
│                        measures skew; pages can come from several files (the opened one plus inserted ones)
├─ deskew.ts             detectSkew: projection-profile skew detection on RGBA pixels (pure; runs in the worker)
├─ pageOps.ts            PageOp = PixelOp (erase | contrast | brightness | despeckle on an ImageRect) | PaperOp (resize
│                        to Letter/Legal) | TextOp (an annotation the host burned in) | ScaleOp (content scaled around the
│                        center, withScaleStep) | DeskewOp (content rotated back by the measured skew) | ShiftOp (content
│                        moved by dx/dy, withShift) and the pure pixel code that applies pixel ops (contrast/brightness use the
│                        CSS filter formulas, so previews match); pageResolution (DPI with fallback), editedPageInfo
│                        (page size after paper ops), paperOp, DESPECKLE_LEVELS / withDespeckleStep
└─ protocol.ts           typed worker request/response messages
```

## Toolbar semantics

- Thin icon = acts on the selected page(s); bold/large icon = acts on all pages.
- Selection (`usePageSelection`): thumbnail click selects one page, Ctrl/Cmd+click or the thumbnail's checkbox toggles, Shift+click selects a range, Ctrl+A in the sidebar selects all, Esc collapses to the current page. At least one page is always selected. Navigating any other way (toolbar, wheel, keyboard) selects just the new page.
- Document edits (rotations, pixel ops, page deletions and page order) are pending: Undo (Ctrl+Z) steps back, Cancel discards, Apply commits. Annotations are not edits. For a document that has an `id` Apply first asks the host to store the new version, see below; a file opened from disk (no `id`) is only committed in memory (Download to PC writes a local file).
- Delete page (thin trash can) marks the selected pages deleted; nothing is removed from the file. Deleted pages are hidden from the sidebar, page numbering/count, navigation (toolbar, wheel, PageUp/Down), range/all selection and printing; the view moves to the page that followed them. It's disabled when the selection covers every remaining page. Undo/Cancel restore them (with their rotations and pixel ops) and show the first restored page.
- Move page down / up (file-caret down / up) move the selected pages one place among the visible pages; adjacent selected pages move as a block, and a block at the edge stays put (the button is disabled when nothing can move). The selection and shown page stay the same. Deleted pages keep their slot in the order, so undoing a delete puts the page back where it was.
- Drag a thumbnail to move pages: dragging a selected thumbnail moves the whole selection (as one block, in display order, even when not adjacent); dragging an unselected one moves just that page, which then becomes the selection and the shown page. A blue line in the gap between thumbnails shows where they'll land (none where the drop wouldn't change the order); near the list's top / bottom edge the list scrolls. `edits.movePagesBefore` (one undo step; deleted pages keep their slots). The app's file drop overlay only reacts to drags carrying files, so thumbnail drags don't trigger it. When hosted, the drop is not opened in the viewer: it is sent as `file-dropped` so the host loads it (its own API) and replies with `open-image`. Standalone, the drop still opens locally.
- Page indexes: `page`, selection, rotations, ops and thumbnails all use the index in the file. `visiblePages` is the display order (edit `order` minus deleted pages); the toolbar's page number/count, `goToPosition`, page navigation, Shift ranges, the sidebar and printing all follow it.
- Full screen (the button after the fit modes) shows the viewer on the whole monitor and leaves again with the same button or Esc. It does not change the fit mode. A host iframe needs `allow="fullscreen"`; otherwise the status bar says the host blocked it.
- Fit modes are Best Fit (whole page), Fit Width (the page's on-screen width fills the viewer, so it follows rotation; the default, `DEFAULT_FIT_MODE`) and Full Size (100%), the three buttons after the zoom box. Fit mode is sticky: it's re-applied on page change, rotation and when the viewer changes size (window, sidebar; `refitAfterResize` keeps a tall page's scroll position and runs after OSD's own resize handling, which would otherwise re-apply the old bounds). Manual zoom (+/−, typed %, Ctrl + wheel) clears it; a page opened after that uses the default fit. Fit Width and Full Size show the page centered across and, when it's taller than the view, starting at its top (at its bottom when the wheel scrolled back from the next page); Fit Width leaves room for the vertical scrollbar.
- Scrollbars: the stage (`.osd-wrap`) is the scrollable element. When the `.canvas-container` is taller or wider than the stage (Fit Width on a tall page, Full Size, zoomed in), the browser scrolls that wrap; the wheel handler moves `scrollTop` / `scrollLeft` and turns pages at the edges. Fit Width sets `.canvas-container` width to the wrap’s content width (minus the 1px border), uses `overflow-x: hidden` so a vertical scrollbar does not spawn a horizontal one, and reserves that scrollbar with `scrollbar-gutter: stable` so it appearing does not change the width and flicker the fit. (Older custom OSD overlay scrollbars were removed — they false-triggered on page change from sub-pixel overflow.)
- Convert to paper size (row 2, after Apply/Cancel): thin file-lines = selected pages to Letter (8.5"×11"), bold file-lines = all pages to Letter, thin file = selected pages to Legal (8.5"×14"), bold file = all pages to Legal. Recorded as a pending `paper` op (`convertPages` in `App.vue`, one undo step for all pages): the worker scales the content to fit (aspect kept), centers it and pads with white, at the page's own DPI (`pageResolution`: TIFF tags, else width / 8.5"). The page is always portrait (Letter 8.5"×11", Legal 8.5"×14"), even when the scan is wider than it is tall; pages already that size get no op. The page size changes, so everything that needs a page size uses `pageInfos` in `App.vue` (edited sizes: margins, thumbnails, status bar), not `doc.pages`. The status bar reports the page as displayed: a 90° or 270° rotation swaps width and height, and the DPI used for the inch size. Ops after a paper op are in the converted page's pixels (ops apply in order).
- Scroll wheel over the image scrolls a page that's taller than the view; at its top or bottom edge (after a 300 ms hold there) it turns pages (one notch = one page), and a page that fits is turned straight away. Shift + wheel (or a sideways swipe) scrolls across. Ctrl + wheel zooms. Handled in `OsdViewer.vue` via OpenSeadragon's `canvas-scroll` event.
- Select area (dashed square) toggles area-select mode: dragging on the page draws a box (instead of panning) that can be moved and resized with 8 handles. Logic is in `src/viewer/useAreaSelection.ts`; the result is `areaSelection` in `App.vue` (an `ImageRect` in page pixels, valid across zoom/pan/rotation). Cleared on page change, by a click without dragging, and by Esc; Esc again or toggling the button leaves the mode. Future area tools (copy, redact, OCR...) should read it from there.
- Area edits on the selection, recorded as pixel ops on the shown page (`editArea` in `App.vue`), the selection stays for further edits:
  - Brightness: slider 25–200% (starts at 120%) in the area popover, previewed live with CSS `backdrop-filter`, Apply records a `brightness` op.
  - Contrast: slider 25–300% (starts at 150%), same preview, Apply records a `contrast` op.
  - Despeckle: popover button. Removes dark (luminance < 128) 8-connected blobs of at most `DEFAULT_SPECK_SIZE` (12) px inside the area.
  - Erase: popover button or Delete/Backspace. Fills the area white.
- Erase tool (row-2 eraser, the main erase feature): toggles erase mode (`eraseMode` in `App.vue`; select-area and erase mode turn each other off). Dragging on the page draws a red dashed box (a second `useAreaSelection` in `OsdViewer.vue` with `onDrawEnd`); on release it emits `erase-area` and App records an `erase` op on the shown page at once (one undo step per rectangle). The mode stays on for more rectangles; Esc or the button turns it off.
- Reposition (row-2 four-way arrows, after the eraser): toggles reposition mode (`repositionMode` in `App.vue`; select-area, erase and reposition are mutually exclusive via `setPageTool`). Dragging on the page moves the shown page's content: `OsdViewer.vue` previews it live (a copy of the page image moved with the pointer, clipped to the page on white, dashed page outline; kept after release until the re-rendered page is swapped in) and emits `reposition` with the move in page pixels; `repositionPage` records it. Arrow keys nudge by 0.05" in that on-screen direction (Shift: 0.5"; `nudgeContent`, mapped through the rotation with `unrotateDelta` and the page DPI). Recorded as a `shift` op (`withShift`: consecutive moves update the page's trailing shift op, so content moved off the page and back isn't lost, and moving back to the start removes it), one undo step per drag / key press. The page size stays; content moved off the page is cropped, the uncovered area is white. Margins stay where they are (that's the point: move content clear of them). The status bar shows how far the shown page's content has moved, in inches as seen on screen. Only the shown page is moved, like the erase tool. Esc or the button turns the mode off.
  After a move (multi-page documents), `MoveAllPrompt.vue` asks at the bottom of the viewer "Move all pages the same way?" with the move so far: All pages / Just this page. It's non-blocking and keeps tracking further drags and nudges on that page (`moveSession` in `App.vue`: the page and its total shift before the first move; the offered move is the difference, so Undo shrinks it and it hides at zero). All pages (`moveAllPages`) moves every other visible page the same distance in inches and the same direction on screen (each page's own DPI and rotation, `src/viewer/contentShift.ts`), as one undo step. The question ends when answered, when another page is shown, on Apply / Cancel and when a document opens.
- Allowed page size: the host sends `allowedPageSize` (`LETTER`, `LEGAL`, `LETTERLEGAL`, or `ANY`) and `threshold` (inches, `0.1` = ±0.1, or a string `-.1/+.1`) on `open-image`, or later with `set-allowed-page-size` (does not dirty the document). `ANY` or a missing size draws no page-size warning. Each visible page is measured in inches from its resolution (after paper ops; landscape counts). A page outside the threshold is an image warning: "Page 1 is not within the allowed page size of Letter" (or Legal, or "(Letter or Legal)").
- Image warnings: when the document has margins, `scanImageWarnings` in `App.vue` (debounced) asks the worker (`inspect-regions` via `TiffDocument.inspectRegions`) whether each guide rectangle on each visible page contains content. The shown page is scanned first; results update incrementally. Inspection downscales to ≤800 px and reads that image once, then samples each guide from the buffer; worker jobs are prioritized so renders beat background inspects (otherwise a 26-page margin scan blocked jumping to the last page). White and near-white (luminance ≥ 250) do not count; a region needs enough dark samples that single-pixel edge noise does not warn. Hits become `ImageWarning`s in `ImageWarnings.vue`; thumbnails of affected pages show a warning icon. Re-scans when guides, ops or page order change; cleared when there are no margins.
- Margins: when a document opens, `loadMargins` provides a `MarginSpec` (null = draw nothing). The host can replace them on the open document with `set-margins` (same object as `open-image`; null clears the guides) without reopening the image or dirtying the document. `guidesByPage` in `App.vue` is the single source: the viewer draws the shown page's entry, the sidebar draws every thumbnail's. Margin band guides carry an `edge` (`top` / `bottom` / `left` / `right`) for warning messages. Margins belong to the page as displayed: rotating a page turns only its content, the margins and other areas stay where they are on screen (top stays top, the upper right box stays upper right). `marginGuides` lays them out on the rotated page and maps them back to unrotated page pixels, so the drawing code needs no rotation logic. The page that is first in the current order gets `firstPage`, the last gets `lastPage`, the rest `defaultPage` (a 1-page document uses `firstPage`). Margin bands are shaded light grey; each `otherAreas` entry is a light grey box with a dashed outline (no label). Lengths are inches. `anchor` flags pick the edges `bounds` is measured from: 5 (1 + 4) = top-right, confirmed by the user — `{ x: 3, y: 0, width: 3, height: 3 }` is the 3"×3" upper right corner, i.e. `x` is the distance from the right edge in to the box's left side. Assumed, not yet confirmed: 2 = bottom (`y` from the bottom edge up to the box's top), no right flag = `x` from the left edge. Inches convert to pixels with the TIFF's XResolution/YResolution (`PageInfo.dpiX/dpiY`); without them the page is assumed to be 8.5" wide.
- Annotations are added by the host, not the toolbar. They stay overlays (not dirty, not undone, not in Apply, print or Download) until the host sends `burn-annotations`, which draws them into their pages as `text` ops (one undo step) and removes the overlays. The next Apply saves that drawing with the other edits. An Editable annotation can be dragged, resized, edited (`AnnotationEditor`) and deleted (trash, Delete/Backspace; Esc deselects). `rect` is in unrotated page pixels, and the text stays upright at any rotation; the box's height is a minimum (it grows down to fit the text). A name keeps one annotation (`AnnotationType`, default `VerbiageStamp`): adding another with that name replaces it. `border` is a 0.72 pt black frame at 75% opacity. An Uneditable annotation can only be moved. The host takes one uneditable overlay off the page with `remove-uneditable-annotation` (not a document edit); looping that command clears them. See "Hosting app and server documents".
- Increase / decrease page size (row 1, the four arrow-small-big buttons: thin up = selected pages, bold up = all pages, thin down = selected, bold down = all): scales the page content around the page center by 5% of the original per click, keeping the page size (enlarged content is cropped at the edges, shrunk content is padded white; no fitting). Recorded as a `scale` op (`edits.scalePages`, one undo step per click); consecutive clicks update the page's trailing scale op (`withScaleStep`: 100 → 105 → 110 %, back to 100 % removes it), so the page is resampled once. Minimum 5 %.
- White out margins (row 2, end: thin file = selected pages, large copy icon = all pages; disabled when the document has no margins): `whiteOutMargins` in `App.vue` records one `erase` op per guide in `guidesByPage`, i.e. every margin band and every `otherAreas` box (so it matches what's drawn, including rotation and paper size), all pages in one undo step.
- Ops are stored in unrotated page pixels, so they stay valid when the page is rotated. Vue reactive arrays can't be posted to the worker; `TiffDocument` converts ops to plain objects.
- Deskew (row 2, end: the slightly tilted memo-pad icons; thin = selected pages, bold = all pages): `deskewPages` in `App.vue` asks the worker to measure each page's skew (`TiffDocument.measureSkew`, `detectSkew` in `src/tiff/deskew.ts`: projection profile of the dark pixels on the page reduced to 1600 px, ±10°, 0.05° steps; 0 when below 0.05°, nearly blank or without clear lines) and records a `deskew` op (rotates the content back around the center, same page size, white corners) on the pages that need it, all in one undo step. Progress and result ("Deskewed 2 of 3 pages", "No skew found") show in the status bar. Ops are measured on the page with its pending ops applied, so deskewing again finds nothing.
- Despeckle pages (row 1, dot grids: thin = selected pages, bold = all pages): starts light and gets more aggressive with every click, per page: `DESPECKLE_LEVELS` removes blobs up to 1×1, 2×2, 3×3, 4×4, 5×5, 6×6, 8×8 and 10×10 px (same blob removal as area despeckle, on the whole page). `withDespeckleStep` finds the page's last whole-page despeckle op (rect = the page) to know its level; consecutive clicks replace a trailing one, so the page is despeckled once. One undo step per click (Undo = one level back); past the last level nothing is recorded. The status bar notice shows the level reached (`notice` in `App.vue`, shared with deskew).
- Download to PC (row 1, floppy disk): `DownloadDialog.vue` asks for a file name (default: the open file's name; characters Windows doesn't allow are dropped, the extension is added) and a type, PDF or TIFF. `downloadDocument` in `App.vue` downloads the document as shown: the visible pages in display order with rotations and all ops, pending ones included (annotations only after the host has burned them in). The worker renders each page (`orientedPage`) and `src/export/` writes the file: `encodePage` (8-bit grayscale when every pixel is gray, else RGB; zlib Deflate via `CompressionStream`), `tiffFile` (multi-page TIFF, compression 8, one strip per page, X/YResolution and PageNumber; reopens in this viewer: utif inflates with pako) and `pdfFile` (one FlateDecode image per page, page size from the DPI). Lossless; a rotated page's DPI is swapped with its sides.
- Insert pages (row 1, file-arrow-up, after Download): picks a TIFF or PDF (converted to TIFF first, see "PDFs" below) from disk and inserts all its pages above the topmost selected page (in display order), then shows the first of them. `insertPagesFromFile` in `App.vue`: `TiffDocument.addFile` decodes the file in the worker and appends its pages to the document (file indexes after the existing pages; the worker keeps one `Source` per file), then `edits.insertPages` puts them in the order. Pending like other edits: earlier states (undo history, committed) get the new pages left out of the order and marked deleted, so Undo / Cancel take them out again (they stay loaded in the worker) and they aren't counted as "deleted" (`deletedCount`). Download to PC writes the combined document, and Apply saves it to the server for a server document.
- Scan (row 1, after Insert pages): shown only when a Dynamsoft product key is set (`canScan`). Inserts scanned pages above the topmost selected page, like Insert pages. `scanPages` in `App.vue` calls `scanToTiff` (`src/scan/scanner.ts`):
  - after connecting it calls `Dynamsoft.Lib.initProgress()` (internal, untyped): DWT 17 only builds its progress dialog when a viewer is bound or `Dynamsoft.DWT.Load()` runs, and `ConvertToBlob` throws without it;
  - first it asks for the source scanner with Dynamsoft's own source dialog (`SelectSourceAsync`; in 17 it resolves with the source index, so 0 is a valid choice, and Cancel rejects "User cancelled the operation.");
  - then `AcquireImage` with `IfShowUI`, so the scanner driver's dialog takes over (settings, feeder, multiple pages). DWT 17 has no `AcquireImageAsync`, and its success callback can come before the pages are in, so the scan is done on `OnPostAllTransfers` or `OnSourceUIClose`;
  - the scanned pages come back as one TIFF (`ConvertToBlob`, `IT_TIF`), and DWT's buffer is cleared;
  - `insertPagesFromFile` then inserts them as a pending edit.

  Cancelling either dialog does nothing ("Scan cancelled" notice); pages already scanned before a cancel or error are kept. Errors (no key, service missing, no scanners) show in the error banner; DWT may show its own dialog as well.
- Search document, validate document and document data were removed at the user's request.

## Hosting app and server documents

- **Host owns storage**: the hosting app loads and stores the TIFF. The viewer is a pure editor: the host pushes TIFF bytes in and handles Apply uploads. That keeps the viewer usable from any company's host.
- **`id`**: the host's own key for a document — any non-empty string, or a number (stored as text). Omit it, or send `null` / `''`, when the image has no key. The viewer echoes that same `id` on events and does not interpret it. A later `set-id` replaces it. `docId` is still read on commands when `id` is absent. Files opened from disk or dropped have none (`documentId` in `App.vue`).
- **Hosted load flow** (viewer stays on Loading until the host finishes):
  1. Host → `image-loading` (`id` optional) — viewer shows a Loading overlay.
  2. Host loads the image from its own storage.
  3. If there is no image → Host → `image-missing` — viewer stops Loading and shows **"No image found, please upload a new image."**
  4. If there is an image → Host → `open-image` with `name`, `buffer` (transfer `[buffer]`), optional `id`, plus **`margins`, `dpiRequirement`, `allowedPageSize`, and `threshold`**. Viewer opens the TIFF and emits `document-loaded`.
  5. Host → `image-cleared` resets to the generic empty state (cancel).

  Prefer this over `load-document`. `?id=` on the viewer URL still self-fetches only when **not** hosted (standalone demos); in an iframe the host must drive the flow above.
- **Dirty**: the document is dirty while `edits.hasChanges` is true (structural compare vs committed). Undo back to the original, Cancel, or edits that cancel out make it clean; Apply (after a successful save) makes it clean.
- **Apply on a server document** (`applyEdits`):
  - **Hosted** (`isHosted()`: iframe or popup) **with an `id`**: exports the TIFF, emits `save-requested` (`id`, `name`, `buffer` transferred), keeps the Saving overlay and stays dirty until the host answers `save-acked` (viewer commits + `document-saved`) or `save-failed` (`message` — edits stay pending). The ack's `id` must be the one from `save-requested`.
  - **Standalone** (opened at the top level with an `id`): still uses the stand-in `saveDocument` in `documentApi.ts`.
  - No `id` (local file, or `open-image` / `set-id` without one): commits in memory only.
- **Events** (`notifyHost`): `{ source: 'tiff-image-viewer', type, ... }`, plus `viewerId` when `?viewerId=<id>`. Posted to `window.parent` / `window.opener`, and as `CustomEvent('tiff-image-viewer:<type>')` on the viewer's window.

  | type | fields | when |
  | --- | --- | --- |
  | `dirty-change` | `id` (string or null), `dirty` | dirty flips either way |
  | `document-loaded` | `id` (string or null) | host `open-image` finished opening (or stand-alone `load-document`) |
  | `save-requested` | `id`, `name`, `buffer` | Apply while hosted and the document has an `id`; host stores it, then `save-acked` / `save-failed` |
  | `file-dropped` | `name`, `buffer` | a file was dropped on a hosted viewer; the viewer does not open it, the host loads it (its API) and `open-image`s the TIFF |
  | `document-saved` | `id` | after `save-acked` (or stand-alone save), once edits are committed |
  | `annotation-result` | `requestId`, `status` (`'Success'` / `'Error'`), `message`, `annotationId` (on success) | answer to `add-annotation` |
  | `annotations-burned` | `requestId`, `status` (`'Success'` / `'Error'`), `message`, `annotations`: `{ annotationId, type, requestId, pageIndex, annotation?, pageSize? }[]` | answer to `burn-annotations`; uneditable entries include the object placed where it was drawn |
  | `uneditable-annotation-removed` | `requestId`, `status` (`'Success'` / `'Error'`), `message`, `annotationId` (when the id was a number), `remaining` | answer to `remove-uneditable-annotation`; `remaining` is how many uneditable overlays are still on the document |
- **Commands** (`listenToHost`): `postMessage({ target: 'tiff-image-viewer', type, ... }, viewerOrigin[, transfer])`.
  - `image-loading`, `id` (optional): host is loading an image (viewer shows Loading).
  - `image-missing`, `id` (optional): the host has no image — show "No image found, please upload a new image."
  - `open-image`, `id?`, `name`, `buffer`, `margins?`, `dpiRequirement?`, `allowedPageSize?`, `threshold?`: TIFF bytes; transfer `[buffer]`. `id` may be a string or a number; omit it to open without a key. Re-send `dpiRequirement` whenever it can change; margins on an open document are updated with `set-margins` (sending them again on a later `open-image` still works). A document `dpiRequirement` is used when `add-annotation` omits `dpi`; otherwise the company's asserted requirement (default 300). `countyDpi` is still read when `dpiRequirement` was not sent. `allowedPageSize` is `LETTER`, `LEGAL`, `LETTERLEGAL`, or `ANY` (missing = `ANY`). `threshold` is the inch tolerance (`0.1` = ±0.1).
  - `set-allowed-page-size`, `allowedPageSize`, `threshold`: same fields as `open-image`. Updates the open document's page-size warnings immediately. `ANY` clears them. Ignored when no document is open or while an image is loading. This does not dirty the document.
  - `set-dpi-requirement`, `dpiRequirement`: assert the company's DPI requirement. A missing or non-positive value restores 300. A document that already has its own value keeps it.
  - `set-margins`, `margins`: margin rules for the open document (`onSetMargins` in `App.vue`), the same object as `open-image` (`firstPage` / `lastPage` / `defaultPage`, inches, `otherAreas`, and the `*MarginsAreZero` flags). Null, a missing value, or a spec with nothing to draw clears the guides. Ignored when no document is open or while an image is loading. Guides, thumbnail marks, image warnings and White out margins update immediately. This does not dirty the document.
  - `set-id`, `id`: replace the open document's key (`null` or `''` clears it). Ignored when no document is open.
  - `image-cleared`: empty the viewer (generic empty state).
  - `save-acked`, `id` / `save-failed`, `id`, `message`: answer to `save-requested`. `id` must match the request.
  - `load-document`, `id`: **dev shortcut** — viewer fetches via stand-in `fetchDocument` (prefer `open-image`).
  - `set-actions`, `apply?`, `cancel?`: label, tooltip (`title`), and colors (`background`, `color`) for the toolbar Apply and Cancel buttons. A missing button is left as it is. `null` restores that button. A field left out is left as it is; `null` or `''` restores that field. Colors are hex or `rgb()` / `rgba()`; anything else is ignored. Labels are plain text (40 characters). The same object is `window.tiffViewerActions` before the app script. Defaults stay Apply `#3d64b5` and Cancel `#6b7686`.
  - `set-icons`, `icons`, `iconFont?`: `{ [name]: string | null }`. Replaces built-in icons (same values as `window.tiffViewerIcons`: image URL, one `<svg>`, or one Font Awesome `<i>`). `null` restores one. `iconFont` is the Font Awesome stylesheet or kit script for `<i>` values (`null` removes it); omit it to leave the current font. Applied whenever the host sends it.
  - `set-scan-license`, `productKey`: the company's Dynamic Web TWAIN product key (same as `window.tiffViewerScanLicense`). A non-empty key shows the scan button; `null` or `''` hides it. Not echoed in events.
  - `add-annotation`, `annotation`, `dpi`, `requestId`: the host adds one annotation (`addHostAnnotation` in `App.vue`). `annotation.type` is `'Editable'` or `'Uneditable'`. Without `type`, `stampType: 'UneditableAnnotation'` (or `'FillInStamp'`) means Uneditable and any other object is Editable. A bad `type` is an `Error`. The host should wait for `document-loaded` first; with no document open (or while saving/loading) the answer is an `Error`. `requestId` (string or number, optional) is echoed in `annotation-result` and again in `annotations-burned`. Annotations are overlays until `burn-annotations`: they do not dirty the document and Apply does not draw them.
    - **Editable** (`legacyAnnotation.ts`): `Text` (`\n` = new line), `XPos`, `YPos`, `Width`, `Height`, `PageIndex` (position in the display order, 0-based; omit it or send `null` to use the page on screen), `FontSize`, `FontBold` / `FontUnderLine` (`"True"` / `"False"`), `Align` (`LEFT` / `CENTER` / `RIGHT`), `Border` (`"True"` = border, like the old opacity 0.75). Named `AnnotationType` (default `VerbiageStamp`); adding another with that name replaces it. `Name`, `FontName` (always Arial) and `AnnotationFilename` are ignored. The user can move, resize, edit and delete it.
    - `dpi` is the DPI requirement for this command. If omitted, the viewer uses the document's `dpiRequirement` from `open-image`, else the company's asserted requirement, else 300. Position, size and `FontSize` are pixels at that DPI on the page as displayed (after its rotation), so they're scaled by the page's DPI / `dpi` per axis (the same whenever `dpi` is 300). `FontSize` becomes pt: `FontSize × 72 / dpi` (48 at 300 dpi = 11.52 pt). The box is clamped to the page; its height grows to fit the text.
    - **Uneditable** (`uneditableAnnotation.ts`): `left` / `top` / `width` / `height` are DPI-requirement pixels (`dpi`) on the page as displayed, on the page at display position `pageIndex` (optional, default 0). Drawn as sent (`fillColor` when `isFill`, `opacity`, font, its `text` (or legacy `Text`), stroke when `isStroke`). The user can drag it and nothing else. Each command adds one (they accumulate). Keep the `annotationId` from `annotation-result` to remove that overlay later.
  - `burn-annotations`, `requestId`: draws every current annotation into its page (`drawRichText` in the worker, upright at the page's rotation, at the page DPI) and removes the overlays. Answers `annotations-burned`. The drawing is a pending edit (one undo step, the document becomes dirty) and is included in the next Apply, print and Download. Uneditable annotations are reported back as sent, with `left` / `top` (requirement pixels; unmoved ones unchanged) and `pageIndex` updated, plus `pageSize`. With none to burn, or no document open, the answer is an `Error`.
  - `remove-uneditable-annotation`, `annotationId`, `requestId`: removes one uneditable overlay (`removeUneditableAnnotation` in `App.vue`). `annotationId` is the number from that annotation's `annotation-result`. Answers `uneditable-annotation-removed`. The overlay is dropped; it is not drawn into the page, and the document does not become dirty. An unknown id, an editable annotation's id, or a missing `annotationId` is an `Error` (the overlays stay). With no document open, or while saving or loading, the answer is an `Error`. A host that stored each `annotationId` loops this command to take them off one by one (`remaining` hits 0 when the last one is gone). The sample hosts' Remove Uneditable Annotations button does that loop.
- **Several viewers on one page**: pass `?viewerId=<id>` on each iframe. Events include that id, and commands and `save-requested` acks stay on that viewer. Keep the viewer free of shared browser state so instances stay independent. Inactive viewers can be `display: none`. A hidden viewer (1×1 px) skips fitting (`unfitted` in `OsdViewer.vue`) and fits when it gets a size.
- **Origin**: `VITE_HOST_ORIGIN` (optional) is the hosting app's origin. When set, events are posted only to it and commands from other origins are ignored; unset means any origin (`'*'`), which is fine for development.
- **PDFs**: users upload PDF or TIFF, but the viewer only works on TIFF. Any PDF opened or inserted in the viewer goes through `asTiff` (`convertPdfToTiff`). Prefer converting on the server before `open-image` when the host owns ingest.
- **Stand-ins**: `fetchDocument` / `saveDocument` (`documentApi.ts`) for stand-alone `?id=` only (local `samples/`). A real host pushes TIFF bytes with `open-image` and handles `save-requested`. Also `convertPdfToTiff` and `loadMargins` (host can pass `margins` on `open-image`, or later with `set-margins`).

Rules to preserve:

- TIFF decoding happens only in the worker. Never decode on the main thread.
- The viewer only works on TIFF. Every file that is opened or inserted goes through `asTiff` (PDFs converted by the API). Don't add PDF rendering to the viewer.
- Only `TiffDocument` talks to the worker. Add new message types to `protocol.ts` first.
- Only `OsdViewer.vue` imports OpenSeadragon. Expose new viewer actions via `defineExpose`.
- Thumbnail requests are queued one at a time so they never delay full-page renders. Keep it that way.
- Blob URLs must be revoked when a document is disposed.
- IFDs with NewSubfileType (tag 254) bit 0 set are reduced-resolution copies and are not shown as pages.

## Known limitations

- Each page is decoded in full and shown via OpenSeadragon's `type: 'image'` tile source. Very large images (roughly >16k px per side) hit browser canvas limits; supporting them needs a tiled/pyramidal tile source.
- The local Git (2.28) is too old for the agent's commit command, so the agent can't create commits until Git is upgraded.

## Conventions

- Match existing style: 2-space indent, no semicolons, single quotes.
- Components stay small and single-purpose; parents own state, children emit events.
- Toolbar: white background, navy icons `#1f3a68` (bold `#27498c`), borders `#c9d1dd`, Apply `#3d64b5`, Cancel `#6b7686`. A company can replace the Apply and Cancel label and those two colors (`set-actions`).
- Sidebar is white (user request): background `#fff`, text `#1d2635`, borders `#c9d1dd`, light panels (status bar, scrollbar track, empty thumbnail frame) `#f4f6f9`, accent `#2f6fd1` (selected thumbnail background `#e8eef8`). The main stage (`.osd-wrap`) is gray `#5a5a5a` and scrolls; the page sits in a sized `.canvas-container` (like the old viewer's canvas: CSS width/height = the displayed page, 1px black border) and the image is scaled to fill that box. Zoom grows/shrinks the container; Fit Width / Best Fit / Full Size set its size from the stage.
