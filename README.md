# TIFF Image Viewer

Browser viewer for single-page and multipage TIFF files. The hosting page owns storage. It embeds the viewer, pushes TIFF bytes in, and stores the file when the user clicks Apply. Everything in the viewer runs in the browser. There is no viewer backend.

The host and the viewer talk with `window.postMessage`. Commands go in. Events come out. Working copies of a host are `examples/host.html` (one viewer) and `examples/tabs.html` (several viewers in tabs). The HTTP API the host calls, with a bearer token, is in [README.dotnet.md](README.dotnet.md).th

## Embed the viewer

Put the built viewer in an iframe. Give each iframe its own `viewerId` when more than one viewer is on the page. Events from that iframe include the same id.

```html
<iframe
  id="viewer"
  title="Document image"
  src="https://viewer.example.com/?viewerId=doc-1"
  allow="fullscreen"
></iframe>
```

`allow="fullscreen"` lets the viewer's Full screen button fill the monitor. Without it the button stays in the page and reports that the host blocked full screen.

A popup works too. Events are posted to `window.parent` and to `window.opener`.

`VITE_HOST_ORIGIN` is the hosting page's origin, baked in when the viewer is built. When it is set, the viewer posts events only to that origin and ignores commands from anywhere else. When it is unset, any origin is accepted, which is what local development uses.

A viewer that is `display: none`, or sized to 1×1 px, skips fitting until it has a real size. Inactive tabs can stay in the page.

## Messages

Every command is a JSON object posted to the iframe's `contentWindow`:

```json
{
  "target": "tiff-image-viewer",
  "type": "image-loading",
  "id": "1842"
}
```

Every event is a JSON object posted back to the host:

```json
{
  "source": "tiff-image-viewer",
  "viewerId": "doc-1",
  "type": "document-loaded",
  "id": "1842"
}
```

`source` is always `"tiff-image-viewer"`. `viewerId` is present when the iframe URL has `?viewerId=`. `target` is how the viewer recognizes a command. A message with the wrong `target`, or a command whose required fields are missing, is ignored and produces no event.

`id` on a command may be a string or a finite number. The viewer stores a number as its decimal text and echoes that string on later events. A blank string, `null`, or a missing id means the image has no key. `docId` is read only when the message has no `id` field.

```javascript
const TARGET = 'tiff-image-viewer'
const viewer = document.getElementById('viewer')

function post(message, transfer) {
  viewer.contentWindow.postMessage(
    { target: TARGET, ...message },
    'https://viewer.example.com',
    transfer,
  )
}

function onViewerEvent(handler) {
  window.addEventListener('message', (event) => {
    if (event.source !== viewer.contentWindow) return
    const data = event.data
    if (!data || data.source !== TARGET) return
    handler(data)
  })
}
```

`postMessage`'s second argument is the viewer's origin. Pass `location.origin` when the iframe is on the same origin, as the sample hosts do.

The same events are also dispatched on the viewer's own window as `CustomEvent` named `tiff-image-viewer:<type>`, with the event object on `detail`. A script inside the viewer page can listen there. A host in the parent page uses `message`.

## Open a document

The viewer stays on a loading overlay until the host finishes. Wait for `document-loaded` before adding annotations.

1. Host sends `image-loading`.
2. Host loads the TIFF from its own storage.
3. No image: host sends `image-missing`. The viewer shows "No image found, please upload a new image."
4. Image found: host sends `open-image` and transfers the TIFF bytes. The viewer emits `document-loaded`.
5. Host sends `image-cleared` to cancel and return to the empty state ("Waiting for the host to open a document").

```javascript
async function openDocument(id) {
  post({ type: 'image-loading', id })
  const image = await fetch(`/api/documents/${id}/tiff`)
  if (image.status === 404) {
    post({ type: 'image-missing', id })
    return
  }
  const buffer = await image.arrayBuffer()
  const margins = await fetch(`/api/documents/${id}/margins`).then((r) => r.json())
  post(
    {
      type: 'open-image',
      id,
      name: `${id}.tif`,
      buffer,
      margins,
      dpiRequirement: 300,
    },
    [buffer],
  )
}

onViewerEvent((event) => {
  if (event.type === 'document-loaded' && event.id === currentId) {
    // Safe to add annotations and margins now.
  }
})
```

`open-image`:

```json
{
  "target": "tiff-image-viewer",
  "type": "open-image",
  "id": "1842",
  "name": "1842.tif",
  "buffer": "<ArrayBuffer of TIFF bytes>",
  "margins": null,
  "dpiRequirement": 300,
  "allowedPageSize": "LETTER",
  "threshold": 0.1
}
```

`buffer` is an `ArrayBuffer`. Transfer it in the third argument of `postMessage` so the bytes move instead of being copied. After the transfer the host's copy is detached. `name` is the file name shown in the status bar. `margins`, `dpiRequirement`, `allowedPageSize`, and `threshold` may be omitted. Send them on `open-image` when they are already known. Margins that arrive later use `set-margins`. The allowed page size can be changed later with `set-allowed-page-size`.

`document-loaded`:

```json
{
  "source": "tiff-image-viewer",
  "viewerId": "doc-1",
  "type": "document-loaded",
  "id": "1842"
}
```

`id` is `null` when the image was opened without a key.

`image-missing` and `image-cleared` have no further fields beyond `type` and, for `image-missing`, an optional `id`.

An image with no key (a local file, or `open-image` / `set-id` without an id) still opens. Apply then commits in the viewer only. Download to PC writes a local file. The host is not asked to store it.

`load-document` is a development shortcut. The viewer fetches the file itself from the local sample folder. A hosting app uses `open-image`. `?id=` on the viewer URL self-fetches only when the viewer is the top-level page. Inside an iframe the host drives the flow above.

## Save

The document is dirty while the user has pending edits: rotations, pixel edits, page deletes, page order, inserted or scanned pages, and annotations after they have been burned in. Overlays (annotations that have not been burned, and margin guides) do not make it dirty.

`dirty-change` is sent only when the flag flips:

```json
{
  "source": "tiff-image-viewer",
  "type": "dirty-change",
  "id": "1842",
  "dirty": true
}
```

Apply on a hosted document that has an `id` exports the TIFF as shown (visible pages, display order, rotations, and pending edits, including burned annotations) and emits `save-requested`. The viewer stays on Saving and stays dirty until the host answers.

```json
{
  "source": "tiff-image-viewer",
  "type": "save-requested",
  "id": "1842",
  "name": "1842.tif",
  "buffer": "<ArrayBuffer of the edited TIFF>"
}
```

`buffer` is transferred. Store it, then answer with the same `id`:

```javascript
onViewerEvent(async (event) => {
  if (event.type !== 'save-requested') return
  if (event.viewerId !== viewerId) return
  try {
    await fetch(`/api/documents/${event.id}/tiff`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/tiff' },
      body: event.buffer,
    })
    post({ type: 'save-acked', id: event.id })
  } catch (err) {
    post({
      type: 'save-failed',
      id: event.id,
      message: err instanceof Error ? err.message : 'Save failed.',
    })
  }
})
```

```json
{ "target": "tiff-image-viewer", "type": "save-acked", "id": "1842" }
```

```json
{
  "target": "tiff-image-viewer",
  "type": "save-failed",
  "id": "1842",
  "message": "The store rejected the upload."
}
```

`save-acked` commits the edits and the viewer emits `document-saved`:

```json
{ "source": "tiff-image-viewer", "type": "document-saved", "id": "1842" }
```

`save-failed` leaves the edits pending and shows `message`. The ack's `id` must be the id from `save-requested`. A different id is ignored and the viewer stays on Saving. If storage assigns a new key, ack the request id first, then send `set-id`.

```json
{ "target": "tiff-image-viewer", "type": "set-id", "id": "1842-v2" }
```

`null` or `""` clears the key, so the next Apply commits in memory only. `set-id` is ignored when no document is open.

## A file dropped on the viewer

While the viewer is hosted, a file dropped on it is not opened. The bytes are transferred to the host as they were dropped (TIFF or PDF). The host runs its own load, converts a PDF to TIFF, and replies with `open-image`.

```json
{
  "source": "tiff-image-viewer",
  "type": "file-dropped",
  "name": "scan.pdf",
  "buffer": "<ArrayBuffer of the dropped file>"
}
```

```javascript
onViewerEvent(async (event) => {
  if (event.type !== 'file-dropped') return
  const tiff = await companyLoadImage(new File([event.buffer], event.name))
  post({ type: 'image-loading', id: tiff.id ?? currentId })
  post(
    {
      type: 'open-image',
      id: tiff.id ?? currentId,
      name: tiff.name,
      buffer: tiff.buffer,
      margins: currentMargins,
      dpiRequirement: 300,
    },
    [tiff.buffer],
  )
})
```

The sample hosts look for `window.tiffHostLoadImage`. That function is part of the sample pages, not of the viewer. Set it on the host page to send a dropped or replaced file through the company's API:

```javascript
window.tiffHostLoadImage = async (file) => {
  const response = await fetch('/api/documents/replace', { method: 'POST', body: file })
  if (!response.ok) throw new Error('Replace failed.')
  return {
    buffer: await response.arrayBuffer(),
    name: file.name.replace(/\.pdf$/i, '.tif'),
    id: '1842',
  }
}
```

Return an `ArrayBuffer` or `Blob` of TIFF bytes, or `{ buffer, name, id }`. Omit `id` to keep the open document's key. `id: null` opens with no key.

The viewer itself only displays TIFF. Convert PDF to TIFF on the server before `open-image`.

## Margins

Margin guides are overlays. They are shaded on the page and on the thumbnails, and they feed image warnings and White out margins. They are not burned into the TIFF unless the user whites them out.

Send them on `open-image`, or later with `set-margins` once `document-loaded` has arrived. `set-margins` replaces the rules on the open document and does not reload the image or mark it dirty. `null`, a missing `margins` value, or a spec with nothing to draw clears the guides. The command is ignored when no document is open or while an image is loading.

Lengths are inches. The page that is first in the current order uses `firstPage`, the last uses `lastPage`, and every other page uses `defaultPage`. A one-page document uses `firstPage`.

```json
{
  "target": "tiff-image-viewer",
  "type": "set-margins",
  "margins": {
    "firstPage": {
      "top": 0.25,
      "bottom": 0.25,
      "left": 0.25,
      "right": 0.25,
      "otherAreas": [
        {
          "bounds": { "x": 3, "y": 0, "width": 3, "height": 3 },
          "anchor": 5
        }
      ]
    },
    "lastPage": {
      "top": 0.25,
      "bottom": 0.25,
      "left": 0.25,
      "right": 0.25,
      "otherAreas": null
    },
    "defaultPage": {
      "top": 0.25,
      "bottom": 0.25,
      "left": 0.25,
      "right": 0.25,
      "otherAreas": null
    },
    "firstPageMarginsAreZero": false,
    "lastPageMarginsAreZero": false,
    "defaultPageMarginsAreZero": false
  }
}
```

`top`, `bottom`, `left`, and `right` are the margin bands. `otherAreas` are extra keep-clear boxes (a recording-stamp box, for example). Each box needs finite `bounds.x`, `bounds.y`, `bounds.width`, `bounds.height`, and `anchor`. A .NET `RectangleF` may include `location`, `size`, and the other fields; only `x`, `y`, `width`, and `height` are read.

`anchor` chooses which page edges `bounds` is measured from:

| `anchor` bit | Value | Meaning |
| --- | --- | --- |
| right | 4 | `x` is the distance from the right edge in to the box's left side |
| bottom | 2 | `y` is the distance from the bottom edge up to the box's top |

Without the right bit, `x` is from the left edge. Without the bottom bit, `y` is from the top. `anchor: 5` (1 + 4) is the upper-right case: `{ "x": 3, "y": 0, "width": 3, "height": 3 }` is the 3 inch by 3 inch upper-right corner.

`firstPageMarginsAreZero`, `lastPageMarginsAreZero`, and `defaultPageMarginsAreZero` force that page's bands to zero and drop its other areas. A missing page object falls back to `defaultPage`, and a missing `defaultPage` falls back to all zeros.

Inches become pixels with the TIFF `XResolution` / `YResolution`. A page with no resolution is treated as 8.5 inches wide. Guides belong to the page as displayed: rotating the page turns the content, and the top margin stays on top.

## Allowed page size

The host sends the paper size this document's pages are allowed to be, and a threshold in inches. Both come from the company's API response and are forwarded on `open-image` (or later with `set-allowed-page-size`). Neither dirties the document.

`allowedPageSize` is one of `LETTER`, `LEGAL`, `LETTERLEGAL`, or `ANY`.

| Value | Allowed size |
| --- | --- |
| `LETTER` | 8.5" × 11" |
| `LEGAL` | 8.5" × 14" |
| `LETTERLEGAL` | Letter or Legal |
| `ANY` | No page-size warning |

A missing or unrecognized size is `ANY`. Landscape counts: 11" × 8.5" is Letter.

`threshold` is how far a page may sit from that size, in inches. `0.1` means 0.1" under or 0.1" over (`-.1/+.1`). A string `"-.2/+.1"` sets the two sides separately: the number before `/` is how far under, the number after is how far over. A missing threshold is exact (no slack).

The viewer measures each visible page in inches from its TIFF resolution (after Convert to Letter or Legal). A page outside the threshold, and not `ANY`, is an image warning:

- `Page 1 is not within the allowed page size of Letter`
- `Page 2 is not within the allowed page size of Legal`
- `Page 3 is not within the allowed page size of (Letter or Legal)`

```json
{ "target": "tiff-image-viewer", "type": "set-allowed-page-size", "allowedPageSize": "LETTERLEGAL", "threshold": 0.1 }
```

The command is ignored when no document is open or while an image is loading.

## DPI requirement

Positions, sizes, and font sizes on annotations are pixels at a DPI requirement, on the page as displayed. The viewer scales them by the page's own DPI divided by that requirement. At 300 dpi on a 300 dpi page the scale is 1.

Resolution used for one `add-annotation`, in order:

1. `dpi` on that command, when it is a positive number.
2. `dpiRequirement` from the `open-image` that opened this document.
3. The company's asserted requirement.
4. 300.

Assert the company's requirement at any time:

```json
{ "target": "tiff-image-viewer", "type": "set-dpi-requirement", "dpiRequirement": 300 }
```

A missing or non-positive value restores 300. A document that already has its own `open-image` value keeps that value for annotations that omit `dpi`. On `open-image` and `set-dpi-requirement`, `countyDpi` is read when the message has no `dpiRequirement` field.

Before the viewer script runs, the same default can be set with `window.tiffViewerDpiRequirement`.

## Annotations

Annotations are added by the host. They stay as overlays: they are not dirty, they are not undone, and Apply, print, and Download do not include them. `burn-annotations` draws them into the page as a pending edit. The next Apply saves that drawing with the other edits.

Wait for `document-loaded`. With no document open, or while the image is loading or saving, the answer is an error.

`requestId` is a string or a number chosen by the host. It is echoed on the result. Omit it and the echo is `null`.

### Add an editable annotation

An editable annotation can be moved, resized, edited, and deleted in the viewer. `AnnotationType` is its name. Adding another with the same name replaces it. The default name is `VerbiageStamp`.

```json
{
  "target": "tiff-image-viewer",
  "type": "add-annotation",
  "requestId": "ann-1",
  "dpi": 300,
  "annotation": {
    "type": "Editable",
    "Text": "Recorded\nthis date",
    "XPos": 150,
    "YPos": 200,
    "Width": 900,
    "Height": 160,
    "PageIndex": 0,
    "FontSize": 48,
    "FontBold": "False",
    "FontUnderLine": "False",
    "Align": "LEFT",
    "Border": "True",
    "AnnotationType": "VerbiageStamp",
    "placeBackground": "#fff3a1",
    "burnBackground": "transparent",
    "image": "data:image/png;base64,..."
  }
}
```

| Field | Meaning |
| --- | --- |
| `type` | `"Editable"`. Omitted, the object is editable unless `stampType` says otherwise. |
| `Text` | The words. `\n` starts a new line. Can be omitted when `html` or `image` is set. |
| `XPos`, `YPos`, `Width`, `Height` | Pixels at `dpi` on the page as displayed. Width and height must be positive. The box is clamped to the page. Height is a minimum and grows down to fit the text. |
| `PageIndex` | Display position, 0-based. Omit it or send `null` to use the page on screen. |
| `FontSize` | Pixels at `dpi`. Converted to points as `FontSize × 72 / dpi`. 48 at 300 dpi is 11.52 pt. |
| `FontBold`, `FontUnderLine` | `"True"` / `"False"` or a boolean. |
| `Align` | `"LEFT"`, `"CENTER"`, or `"RIGHT"`. |
| `Border` | `"True"` draws a 0.72 pt black frame at 75% opacity when the annotation is burned in. |
| `placeBackground` | Fill shown while the box is on the page. A color, or `"transparent"` / `null` for none. Omitted draws no fill. |
| `burnBackground` | Fill drawn into the page on burn. A color, or `"transparent"` / `null` for none. Omitted draws no fill. Independent of `placeBackground`. |
| `image` | A picture inserted inline at the end of the text, in the flow with the words. A `data:image/…` URL or an `http(s)` address (`Image` is accepted too). The annotation editor's picture button inserts one the same way, at the caret. |
| `html` | HTML drawn instead of the rich text (`Html` is accepted too). `<style>` and `<img>` render. Scripts, event handlers, and frames are dropped. `Text` can be omitted when `html` or `image` is set. |
| `AnnotationType` | Name. Default `VerbiageStamp`. |
| `Name`, `FontName`, `AnnotationFilename` | Ignored. Text is drawn in Arial. |

### Add an uneditable annotation

An uneditable annotation can be dragged and nothing else. Each command adds one. They accumulate.

```json
{
  "target": "tiff-image-viewer",
  "type": "add-annotation",
  "requestId": 7,
  "dpi": 300,
  "annotation": {
    "type": "Uneditable",
    "stampType": "UneditableAnnotation",
    "text": "Uneditable annotation",
    "left": 200,
    "top": 420,
    "width": 780,
    "height": 160,
    "pageIndex": 0,
    "fontFamily": "Arial",
    "fontSize": 42,
    "fontStyle": "normal",
    "fontWeight": "bold",
    "fontColor": "#000000",
    "underlineVisible": false,
    "linethrough": false,
    "textAlign": "LEFT",
    "alignItem": "top",
    "opacity": 100,
    "placeBackground": "#fff3a1",
    "burnBackground": "transparent",
    "isFill": true,
    "fillColor": "#fff3a1",
    "isStroke": true,
    "strokeColor": "#1f3a68",
    "strokeWidth": 2,
    "dashType": "solid"
  }
}
```

`type: "Uneditable"` is the current marker. Without `type`, `stampType: "UneditableAnnotation"` or the older `"FillInStamp"` means the same thing. Any other `type` is an error.

`left`, `top`, `width`, and `height` are required pixels at `dpi` on the page as displayed. `width` and `height` must be positive. `pageIndex` is the display position (0-based) and defaults to the first page. `text` is the label (`Text` is accepted too). `opacity` is 0–100. `alignItem` is `top`, `middle`, `center`, or `bottom`. `textAlign` is `LEFT`, `CENTER`, or `RIGHT`. `dashType` is `solid`, `dash` / `dashed`, or `dot` / `dotted`. `placeBackground` is the fill the user sees while placing the box. `burnBackground` is the fill drawn into the page, and it can be a different color or `"transparent"`. A color is `#rgb`, `#rrggbb`, `#rrggbbaa`, or `rgb()` / `rgba()`. `null`, `""`, `"transparent"`, or `"none"` draws no fill. Leave a field out and that side uses `fillColor` when `isFill` (default `#ffff00`), or no fill when `isFill` is not set. An invalid color is ignored. `isStroke` draws `strokeColor` (default black) at `strokeWidth`.

`image` is a picture inserted inline at the end of the text (a data URL or an `http(s)` address), so it sits in the line with the words. `html` is drawn instead of `text`: a fragment with CSS and `<img>` tags. Its `<style>` stays inside the box. Scripts, event handlers, and frames are removed. When `html` is set, `text` and `image` are not drawn. An `http(s)` image has to be readable by the viewer page or it is skipped when the annotation is burned in. A data URL always burns in.

### The add result

```json
{
  "source": "tiff-image-viewer",
  "type": "annotation-result",
  "requestId": "ann-1",
  "status": "Success",
  "message": "Add success",
  "annotationId": 3
}
```

On `Error`, `message` says why (`annotationId` is omitted). Keep `annotationId` for each uneditable annotation. It is the id `remove-uneditable-annotation` uses, and it is reported again when the annotation is burned in.

A typical error is no document open, the image still loading, a save in progress, `type` other than `Editable` or `Uneditable`, a missing or non-numeric field, or a `PageIndex` / `pageIndex` past the last visible page.

### Remove uneditable annotations

`remove-uneditable-annotation` takes one uneditable overlay off the page. It does not draw it into the image and does not make the document dirty. An integration that stored each `annotationId` loops the command until they are gone. One button can run that loop.

```javascript
const pending = new Map()

function removeUneditable(annotationId) {
  const requestId = nextRequestId()
  const result = new Promise((resolve) => pending.set(requestId, resolve))
  post({ type: 'remove-uneditable-annotation', annotationId, requestId })
  return result
}

async function removeAllUneditable(ids) {
  for (const annotationId of ids) {
    const result = await removeUneditable(annotationId)
    if (result.status === 'Error') break
    if (result.remaining === 0) break
  }
}

onViewerEvent((event) => {
  if (event.type !== 'uneditable-annotation-removed') return
  const resolve = pending.get(event.requestId)
  if (resolve) {
    pending.delete(event.requestId)
    resolve(event)
  }
})
```

Command:

```json
{
  "target": "tiff-image-viewer",
  "type": "remove-uneditable-annotation",
  "annotationId": 3,
  "requestId": "rm-3"
}
```

`annotationId` is the integer from `annotation-result`. A missing or non-integer id is an error.

Result:

```json
{
  "source": "tiff-image-viewer",
  "type": "uneditable-annotation-removed",
  "requestId": "rm-3",
  "status": "Success",
  "message": "Remove success",
  "annotationId": 3,
  "remaining": 2
}
```

`remaining` is how many uneditable overlays are still on the document. An unknown id, or an editable annotation's id, comes back as `Error` with the overlays left in place. The same is true when no document is open or the image is loading or saving.

### Burn annotations

`burn-annotations` draws every current overlay into its page and removes the overlays. That drawing is one undo step. The document becomes dirty. The next Apply, print, and Download include it.

```json
{ "target": "tiff-image-viewer", "type": "burn-annotations", "requestId": "burn-1" }
```

```json
{
  "source": "tiff-image-viewer",
  "type": "annotations-burned",
  "requestId": "burn-1",
  "status": "Success",
  "message": "Burned 2 annotations.",
  "annotations": [
    {
      "annotationId": 1,
      "type": "Editable",
      "requestId": "ann-1",
      "pageIndex": 0,
      "x": 150,
      "y": 200,
      "width": 900,
      "height": 160,
      "dpi": 300,
      "pageSize": { "width": 2550, "height": 3300 }
    },
    {
      "annotationId": 3,
      "type": "Uneditable",
      "requestId": 7,
      "pageIndex": 0,
      "x": 200,
      "y": 510,
      "width": 780,
      "height": 160,
      "dpi": 300,
      "annotation": {
        "type": "Uneditable",
        "stampType": "UneditableAnnotation",
        "text": "Uneditable annotation",
        "left": 200,
        "top": 510,
        "width": 780,
        "height": 160,
        "pageIndex": 0
      },
      "pageSize": { "width": 2550, "height": 3300 }
    }
  ]
}
```

Each entry's `requestId` is the id from the `add-annotation` that created it. `pageIndex` is the display position of the page it was drawn on. `annotationId` is the id from `annotation-result`.

`x`, `y`, `width`, and `height` are where that box was drawn, in the page's own pixels, as displayed. `dpi` is that page's resolution, so it matches the image. The page in the example above is 300 dpi, which is why those pixels match the positions that were sent. A 200 dpi scan reports `dpi` 200, and the box in that image's pixels, even when it was placed at a 300 dpi requirement. `pageSize` is the page in those same pixels. A box the user moved or resized comes back where it was drawn.

An uneditable entry also includes `annotation`. That is the object as sent, with `left`, `top`, `width`, `height`, and `pageIndex` of where it was drawn. Those four numbers match `x`, `y`, `width`, and `height`.

With nothing to burn, or with no document open, the status is `Error` and `annotations` is `[]`.

## Apply and Cancel

A company can rename the toolbar Apply and Cancel buttons and set their colors. A field left out stays as it is. `null` or `""` on a field restores that default. `null` for the whole button restores all of its defaults. Colors are `#rgb`, `#rrggbb`, `#rrggbbaa`, or `rgb()` / `rgba()`. Anything else is ignored. Labels are plain text, up to 40 characters.

```json
{
  "target": "tiff-image-viewer",
  "type": "set-actions",
  "apply": { "label": "Save", "title": "Save the image", "background": "#0a7a3e", "color": "#ffffff" },
  "cancel": { "label": "Discard", "background": "#8a1c1c", "color": "#ffffff" }
}
```

The same object can be set as `window.tiffViewerActions` before the viewer script runs. The built-in labels are Apply and Cancel. The built-in colors are `#3d64b5` and `#6b7686`.

## Icons

Built-in toolbar icons can be replaced by name. A value is an image URL (`https:`, a site path, or `data:image/…`), one `<svg>` element, or one Font Awesome `<i>` tag. `null` or `""` restores the built-in icon. Unknown names are ignored. SVG and `<i>` overrides are sanitized: scripts, event handlers, and anything other than the icon element are dropped. An `<i>` keeps its `class` only.

```json
{
  "target": "tiff-image-viewer",
  "type": "set-icons",
  "iconFont": "https://company.example/fontawesome/css/all.min.css",
  "icons": {
    "print": "<i class=\"fa-solid fa-print\"></i>",
    "trash": "/icons/trash.png",
    "download": null
  }
}
```

`iconFont` is the company's Font Awesome stylesheet, or a kit script URL (a path ending in `.js`). It is loaded inside the viewer, so the host page's own Font Awesome does not have to be visible to the iframe. Omit `iconFont` to leave the current font in place. `null` removes it. An `<i>` draws nothing until that font is loaded.

The same map can be set as `window.tiffViewerIcons` before the viewer script runs, and the font URL as `window.tiffViewerIconFont`.

Names: `sidebar`, `undo`, `print`, `download`, `insert`, `stamp`, `scan`, `trash`, `rotate-left`, `rotate-right`, `move-down`, `move-up`, `select-area`, `brightness`, `contrast`, `despeckle`, `scale-up`, `scale-down`, `spinner`, `caret-left`, `caret-right`, `zoom-in`, `zoom-out`, `fit-page`, `fit-width`, `fit-actual`, `letter`, `legal`, `white-out`, `eraser`, `reposition`, `deskew`, `warning`, `chevron-down`, `checkbox`, `checkbox-on`, `bold`, `italic`, `underline`, `font`, `align-left`, `align-center`, `align-right`, `edit`, `close`.

## Toolbar buttons

A company can hide toolbar buttons by name. This is separate from icons: a thin button and the large "all pages" button share an icon, and each has its own name. `false` hides a button. `true`, `null`, or `""` shows it again. A name left out stays as it is. Unknown names are ignored. Every button starts visible.

```json
{
  "target": "tiff-image-viewer",
  "type": "set-buttons",
  "buttons": {
    "print": false,
    "rotate-left-all": false,
    "rotate-right-all": false,
    "download": true
  }
}
```

The same map can be set as `window.tiffViewerButtons` before the viewer script runs.

Names: `sidebar`, `undo`, `print`, `download`, `insert`, `scan`, `delete`, `rotate-left`, `rotate-right`, `rotate-left-all`, `rotate-right-all`, `move-down`, `move-up`, `select-area`, `brightness`, `despeckle`, `despeckle-all`, `scale-up`, `scale-up-all`, `scale-down`, `scale-down-all`, `apply`, `cancel`, `letter`, `letter-all`, `legal`, `legal-all`, `page-nav`, `zoom`, `fit-page`, `fit-width`, `fit-actual`, `fullscreen`, `white-out`, `white-out-all`, `erase`, `reposition`, `deskew`, `deskew-all`.

`delete` is the trash-can button. `brightness` is the brightness and contrast button. `page-nav` is the previous page, page number, and next page together. `zoom` is the zoom percentage and the zoom in and zoom out buttons. A name ending in `-all` is the large button that acts on every page. The thin button with the same icon acts on the selected pages.

Scan stays hidden until a product key is set, even when `scan` is `true`. Hiding `undo` also turns off Ctrl+Z. Hiding `page-nav` also turns off Page Up and Page Down. Scrolling the page and Ctrl+wheel zoom are unchanged.

## Scanning

The scan button is hidden until a Dynamsoft Dynamic Web TWAIN product key is set. The key is never sent back on an event.

```json
{
  "target": "tiff-image-viewer",
  "type": "set-scan-license",
  "productKey": "the-company-key"
}
```

`null` or `""` hides the button again. The same key can be baked in at build time with `VITE_DWT_PRODUCT_KEY`, or set as `window.tiffViewerScanLicense` before the viewer script runs.

Scanning also needs the Dynamsoft Service on the user's PC. The viewer offers that installer when the service is missing.

## Several viewers

Pass a distinct `?viewerId=` on each iframe. Check `event.viewerId` before handling `save-requested`, annotation results, and the other events. Post commands to that iframe's `contentWindow`. `save-acked` / `save-failed` must go to the viewer that emitted `save-requested`.

`examples/tabs.html` hosts three viewers this way, plus an empty fourth tab.

## Run the sample host

```bash
npm install
npm run samples
npm run dev
```

Open http://localhost:5173/examples/host.html. The left side loads a TIFF from `samples/` and posts `open-image`. The viewer is the right-hand iframe. `examples/tabs.html` is the multi-viewer page. Both only work against the local dev server, because they read `samples/`.

`npm run samples` writes `single-page.tif`, `multi-page.tif`, `speckled.tif`, and `skewed.tif`. `samples/margins.json` is the margin spec the sample host sends.

## Command reference

| `type` | Fields | |
| --- | --- | --- |
| `image-loading` | `id?` | Show the loading overlay. |
| `open-image` | `id?`, `name`, `buffer`, `margins?`, `dpiRequirement?`, `allowedPageSize?`, `threshold?` | Open TIFF bytes. Transfer `[buffer]`. |
| `image-missing` | `id?` | No image for this document. |
| `image-cleared` | | Empty the viewer. |
| `save-acked` | `id` | The Apply TIFF was stored. `id` matches `save-requested`. |
| `save-failed` | `id`, `message` | The store rejected it. Edits stay pending. |
| `set-id` | `id` | Replace the open document's key. `null` clears it. |
| `set-margins` | `margins` | Margin rules for the open document. `null` clears the guides. |
| `set-allowed-page-size` | `allowedPageSize`, `threshold` | `LETTER`, `LEGAL`, `LETTERLEGAL`, or `ANY`, and the inch tolerance. |
| `set-dpi-requirement` | `dpiRequirement` | Company DPI requirement. Missing or non-positive restores 300. |
| `set-actions` | `apply?`, `cancel?` | Label, tooltip, and colors for Apply and Cancel. `null` restores a button. |
| `set-icons` | `icons`, `iconFont?` | Image URL, `<svg>`, Font Awesome `<i>`, or null, by icon name. `iconFont` is the Font Awesome CSS or kit script. |
| `set-buttons` | `buttons` | `false` hides a toolbar button. `true`, `null`, or `""` shows it. A name left out stays as it is. |
| `set-scan-license` | `productKey` | Dynamic Web TWAIN key. `null` hides Scan. |
| `add-annotation` | `annotation`, `dpi?`, `requestId?` | Add one editable or uneditable overlay. |
| `remove-uneditable-annotation` | `annotationId`, `requestId?` | Remove one uneditable overlay. |
| `burn-annotations` | `requestId?` | Draw every overlay into its page. |
| `load-document` | `id` | Dev only. The viewer fetches the file itself. |

## Event reference

| `type` | Fields | When |
| --- | --- | --- |
| `document-loaded` | `id` | `open-image` finished opening. |
| `dirty-change` | `id`, `dirty` | Dirty flips either way. |
| `save-requested` | `id`, `name`, `buffer` | Apply, hosted, and the document has an id. |
| `document-saved` | `id` | After `save-acked` commits the edits. |
| `file-dropped` | `name`, `buffer` | A file was dropped on a hosted viewer. |
| `annotation-result` | `requestId`, `status`, `message`, `annotationId?` | Answer to `add-annotation`. |
| `uneditable-annotation-removed` | `requestId`, `status`, `message`, `annotationId?`, `remaining` | Answer to `remove-uneditable-annotation`. |
| `annotations-burned` | `requestId`, `status`, `message`, `annotations` | Answer to `burn-annotations`. |

`status` on the annotation events is `"Success"` or `"Error"`.
