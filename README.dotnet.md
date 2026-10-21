# Host HTTP API (.NET)

The viewer has no backend. The hosting page calls this API with the user's token, then pushes the results into the viewer with `postMessage`. Viewer messages, including `open-image`, `set-margins`, and annotations, are in [README.md](README.md).

This file is a mock of the controllers and models. It does not include `Program.cs`, authentication middleware, or dependency injection. The host application already authenticates the caller. Every request carries that token:

```http
Authorization: Bearer <token>
```

The viewer never sees the token. Do not put it on a `postMessage`.

JSON property names are camelCase, except an editable annotation, which keeps the viewer's legacy names (`Text`, `XPos`, `PageIndex`, and the rest). The host can pass `documentMargins` and each annotation object through to the viewer without renaming fields.

## Endpoints

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| `GET` | `/api/documents/{id}/image` | | Whether a TIFF exists, plus margins and the DPI requirement. |
| `GET` | `/api/documents/{id}/tiff` | | The stored TIFF (`image/tiff`). |
| `PUT` | `/api/documents/{id}/tiff` | TIFF bytes from Apply | Stores the edited TIFF. |
| `POST` | `/api/documents/{id}/tiff` | Multipart file, field `file` | PDF or TIFF in, TIFF bytes back. Does not store them. |
| `GET` | `/api/documents/{id}/annotations` | | Stamps the host should add after `document-loaded`. |

`{id}` is the document key the viewer echoes on events. A numeric key is sent as text (`1842`).

## Open a document

The host tells the viewer it is loading, asks this API if an image exists, then either reports it missing or transfers the TIFF.

```javascript
const token = session.accessToken

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  })
  if (!response.ok) throw new Error(await response.text())
  return response
}

async function openDocument(id) {
  post({ type: 'image-loading', id })
  const image = await api(`/api/documents/${id}/image`).then((r) => r.json())
  if (!image.imageExists) {
    post({ type: 'image-missing', id })
    return
  }
  const tiff = await api(`/api/documents/${id}/tiff`)
  const buffer = await tiff.arrayBuffer()
  post(
    {
      type: 'open-image',
      id: image.id,
      name: image.name,
      buffer,
      margins: image.documentMargins,
      dpiRequirement: image.dpiRequirement,
    },
    [buffer],
  )
}
```

`GET /api/documents/1842/image` when a TIFF is stored:

```json
{
  "imageExists": true,
  "id": "1842",
  "name": "1842.tif",
  "dpiRequirement": 300,
  "documentMargins": {
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

The same call when the document has no scan yet:

```json
{
  "imageExists": false,
  "id": "empty",
  "name": null,
  "dpiRequirement": 300,
  "documentMargins": null
}
```

The host sends `image-missing` for that response. `GET .../tiff` on a document with no image is `404`. An unknown document id is also `404`; the host then sends `image-cleared` so the viewer does not stay on Loading.

`documentMargins` is the object `open-image` and `set-margins` accept. Lengths are inches. `anchor` bits are in [README.md](README.md): `4` measures `x` from the right edge, `2` measures `y` from the bottom, and `5` is the upper-right box. A true `*MarginsAreZero` flag clears that page's bands and other areas. `null` margins draw nothing.

`dpiRequirement` is the document's DPI requirement. The host sends it as `dpiRequirement` on `open-image`. Omit it from the JSON when the company default (300, or `set-dpi-requirement`) should apply. The viewer still accepts `countyDpi` on the viewer command when `dpiRequirement` is absent. This API only returns `dpiRequirement`.

`GET /api/documents/1842/tiff` responds with `Content-Type: image/tiff` and the file bytes. The host transfers that `ArrayBuffer` on `open-image`.

## Save

Apply emits `save-requested` with the edited TIFF. The host stores those bytes, then acks the same id.

```javascript
onViewerEvent(async (event) => {
  if (event.type !== 'save-requested') return
  const response = await fetch(`/api/documents/${event.id}/tiff`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'image/tiff',
    },
    body: event.buffer,
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Save failed.' }))
    post({ type: 'save-failed', id: event.id, message: error.message })
    return
  }
  const saved = await response.json()
  post({ type: 'save-acked', id: event.id })
  if (saved.id !== event.id) post({ type: 'set-id', id: saved.id })
})
```

`PUT` response:

```json
{ "id": "1842" }
```

`save-acked` must use the id from `save-requested`. When the store assigns a new key, ack the original id, then `set-id`.

## Replace a dropped file

A file dropped on a hosted viewer arrives as `file-dropped` (the original PDF or TIFF). The host posts it here. The response is TIFF bytes to `open-image`. This route does not store the file. The stored copy changes when Apply sends `PUT`.

```javascript
window.tiffHostLoadImage = async (file) => {
  const body = new FormData()
  body.append('file', file)
  const response = await fetch(`/api/documents/${currentId}/tiff`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body,
  })
  if (!response.ok) throw new Error('Replace failed.')
  const name = response.headers.get('X-Document-Name') || file.name.replace(/\.pdf$/i, '.tif')
  const id = response.headers.get('X-Document-Id')
  return {
    buffer: await response.arrayBuffer(),
    name,
    ...(id ? { id } : {}),
  }
}
```

`X-Document-Name` is the TIFF file name. `X-Document-Id` is set only when the upload belongs to a different document key. The sample host's `tiffHostLoadImage` return value is described in [README.md](README.md).

## Annotations

Overlays are not read by the viewer from this API. After `document-loaded`, the host fetches the stamps and sends one `add-annotation` per item. Field meanings are in [README.md](README.md).

`GET /api/documents/1842/annotations`:

```json
{
  "dpiRequirement": 300,
  "editable": [
    {
      "type": "Editable",
      "Text": "Recorded\nthis date",
      "XPos": 150,
      "YPos": 200,
      "Width": 900,
      "Height": 160,
      "PageIndex": 0,
      "FontSize": 48,
      "FontBold": false,
      "FontUnderLine": false,
      "Align": "LEFT",
      "Border": true,
      "AnnotationType": "VerbiageStamp"
    }
  ],
  "uneditable": [
    {
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
      "fontWeight": "bold",
      "isFill": true,
      "fillColor": "#fff3a1",
      "isStroke": true,
      "strokeColor": "#1f3a68",
      "strokeWidth": 2
    }
  ]
}
```

```javascript
onViewerEvent(async (event) => {
  if (event.type !== 'document-loaded' || event.id !== currentId) return
  const stamps = await api(`/api/documents/${event.id}/annotations`).then((r) => r.json())
  for (const annotation of stamps.editable) {
    post({ type: 'add-annotation', requestId: nextRequestId(), dpi: stamps.dpiRequirement, annotation })
  }
  for (const annotation of stamps.uneditable) {
    post({ type: 'add-annotation', requestId: nextRequestId(), dpi: stamps.dpiRequirement, annotation })
  }
})
```

Keep each uneditable `annotationId` from `annotation-result` if the page will remove them later. Burning and the following Apply persist the drawing inside the TIFF from `PUT`. There is no separate save for overlays.

## Models

```csharp
using System.Text.Json.Serialization;

namespace TiffViewer.Host;

public sealed class ApiError
{
    public string Message { get; set; } = "";
}

public sealed class DocumentImage
{
    public bool ImageExists { get; set; }

    /// <summary>The document key. The viewer echoes this string on events.</summary>
    public string Id { get; set; } = "";

    /// <summary>File name for open-image. Null when <see cref="ImageExists"/> is false.</summary>
    public string? Name { get; set; }

    /// <summary>DPI requirement for annotation coordinates. Null lets the viewer use its company default.</summary>
    public int? DpiRequirement { get; set; }

    /// <summary>Margin rules passed through to open-image or set-margins. Null draws nothing.</summary>
    public DocumentMargins? DocumentMargins { get; set; }
}

public sealed class DocumentMargins
{
    public PageMargins? FirstPage { get; set; }
    public PageMargins? LastPage { get; set; }
    public PageMargins? DefaultPage { get; set; }
    public bool FirstPageMarginsAreZero { get; set; }
    public bool LastPageMarginsAreZero { get; set; }
    public bool DefaultPageMarginsAreZero { get; set; }
}

/// <summary>Lengths are inches.</summary>
public sealed class PageMargins
{
    public double Top { get; set; }
    public double Bottom { get; set; }
    public double Left { get; set; }
    public double Right { get; set; }
    public List<OtherArea>? OtherAreas { get; set; }
}

public sealed class OtherArea
{
    public AreaBounds Bounds { get; set; } = new();

    /// <summary>4 = x from the right edge. 2 = y from the bottom edge. 5 = upper right.</summary>
    public int Anchor { get; set; }
}

public sealed class AreaBounds
{
    public double X { get; set; }
    public double Y { get; set; }
    public double Width { get; set; }
    public double Height { get; set; }
}

public sealed class SavedDocument
{
    public string Id { get; set; } = "";
}

public sealed class DocumentAnnotations
{
    public int DpiRequirement { get; set; } = 300;
    public List<EditableAnnotation> Editable { get; set; } = new();
    public List<UneditableAnnotation> Uneditable { get; set; } = new();
}

/// <summary>
/// Legacy names are preserved so this object can be posted as add-annotation's annotation.
/// </summary>
public sealed class EditableAnnotation
{
    public string Type { get; set; } = "Editable";

    [JsonPropertyName("Text")]
    public string Text { get; set; } = "";

    [JsonPropertyName("XPos")]
    public double XPos { get; set; }

    [JsonPropertyName("YPos")]
    public double YPos { get; set; }

    [JsonPropertyName("Width")]
    public double Width { get; set; }

    [JsonPropertyName("Height")]
    public double Height { get; set; }

    /// <summary>Display position, 0-based. Null means the page on screen.</summary>
    [JsonPropertyName("PageIndex")]
    public int? PageIndex { get; set; }

    [JsonPropertyName("FontSize")]
    public double FontSize { get; set; } = 48;

    [JsonPropertyName("FontBold")]
    public bool FontBold { get; set; }

    [JsonPropertyName("FontUnderLine")]
    public bool FontUnderLine { get; set; }

    [JsonPropertyName("Align")]
    public string Align { get; set; } = "LEFT";

    [JsonPropertyName("Border")]
    public bool Border { get; set; }

    [JsonPropertyName("AnnotationType")]
    public string AnnotationType { get; set; } = "VerbiageStamp";
}

/// <summary>CamelCase JSON matches the viewer's uneditable annotation.</summary>
public sealed class UneditableAnnotation
{
    public string Type { get; set; } = "Uneditable";
    public string StampType { get; set; } = "UneditableAnnotation";
    public string Text { get; set; } = "";
    public double Left { get; set; }
    public double Top { get; set; }
    public double Width { get; set; }
    public double Height { get; set; }

    /// <summary>Display position, 0-based. The viewer uses the first page when this is omitted.</summary>
    public int? PageIndex { get; set; }

    public string? FontFamily { get; set; }
    public double FontSize { get; set; } = 42;
    public string? FontStyle { get; set; }
    public string? FontWeight { get; set; }
    public string? FontColor { get; set; }
    public bool UnderlineVisible { get; set; }
    public bool Linethrough { get; set; }
    public string? TextAlign { get; set; }
    public string? AlignItem { get; set; }
    public double? Opacity { get; set; }
    public bool IsFill { get; set; }
    public string? FillColor { get; set; }
    public bool IsStroke { get; set; }
    public string? StrokeColor { get; set; }
    public double StrokeWidth { get; set; } = 1;
    public string? DashType { get; set; }
}
```

`JsonPropertyName` is `System.Text.Json.Serialization.JsonPropertyName`. The host's existing JSON options should use camelCase for everything else. A bounds object may also carry a .NET `RectangleF`'s extra fields (`location`, `size`, `left`, `top`). The viewer reads `x`, `y`, `width`, and `height`.

## Documents controller

`[Authorize]` stands in for the host's existing bearer-token check. `MockStore` stands in for the document store. A real action uses the caller's token to read and write that store. `ReadTiff` below returns an empty buffer so the sample has no file to embed. A real store returns the TIFF bytes. The viewer rejects an empty buffer.

```csharp
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace TiffViewer.Host;

[ApiController]
[Authorize]
[Route("api/documents")]
public sealed class DocumentsController : ControllerBase
{
    [HttpGet("{id}/image")]
    public ActionResult<DocumentImage> GetDocumentImage(string id)
    {
        var image = MockStore.FindImage(id);
        if (image is null) return NotFound(new ApiError { Message = "Document not found." });
        return Ok(image);
    }

    [HttpGet("{id}/tiff")]
    public IActionResult GetDocumentTiff(string id)
    {
        var image = MockStore.FindImage(id);
        if (image is null) return NotFound(new ApiError { Message = "Document not found." });
        if (!image.ImageExists) return NotFound(new ApiError { Message = "No image found." });

        var tiff = MockStore.ReadTiff(id);
        return File(tiff, "image/tiff", image.Name);
    }

    [HttpPut("{id}/tiff")]
    public ActionResult<SavedDocument> SaveDocumentTiff(string id)
    {
        if (!string.Equals(Request.ContentType, "image/tiff", StringComparison.OrdinalIgnoreCase))
            return StatusCode(StatusCodes.Status415UnsupportedMediaType, new ApiError { Message = "Content-Type must be image/tiff." });

        using var buffer = new MemoryStream();
        Request.Body.CopyTo(buffer);
        if (buffer.Length == 0) return BadRequest(new ApiError { Message = "The TIFF was empty." });

        var savedId = MockStore.SaveTiff(id, buffer.ToArray());
        return Ok(new SavedDocument { Id = savedId });
    }

    /// <summary>
    /// Accepts a PDF or TIFF upload and returns TIFF bytes for open-image.
    /// A PDF is converted on the server. The stored document changes only when Apply calls PUT.
    /// </summary>
    [HttpPost("{id}/tiff")]
    public async Task<IActionResult> ConvertUpload(string id, IFormFile? file)
    {
        if (file is null || file.Length == 0)
            return BadRequest(new ApiError { Message = "A PDF or TIFF file is required." });

        await using var input = file.OpenReadStream();
        using var buffer = new MemoryStream();
        await input.CopyToAsync(buffer);
        var tiff = MockStore.ToTiff(file.FileName, buffer.ToArray());

        var name = Path.ChangeExtension(file.FileName, ".tif");
        Response.Headers["X-Document-Name"] = name;
        return File(tiff, "image/tiff", name);
    }
}

/// <summary>Stand-in data. Replace these methods with the company's store, using the caller's bearer token.</summary>
static class MockStore
{
    public static DocumentImage? FindImage(string id) => id switch
    {
        "1842" => new DocumentImage
        {
            ImageExists = true,
            Id = "1842",
            Name = "1842.tif",
            DpiRequirement = 300,
            DocumentMargins = new DocumentMargins
            {
                FirstPage = new PageMargins
                {
                    Top = 0.25,
                    Bottom = 0.25,
                    Left = 0.25,
                    Right = 0.25,
                    OtherAreas = new List<OtherArea>
                    {
                        new()
                        {
                            Anchor = 5,
                            Bounds = new AreaBounds { X = 3, Y = 0, Width = 3, Height = 3 },
                        },
                    },
                },
                LastPage = new PageMargins { Top = 0.25, Bottom = 0.25, Left = 0.25, Right = 0.25 },
                DefaultPage = new PageMargins { Top = 0.25, Bottom = 0.25, Left = 0.25, Right = 0.25 },
            },
        },
        "empty" => new DocumentImage { ImageExists = false, Id = "empty", DpiRequirement = 300 },
        _ => null,
    };

    public static byte[] ReadTiff(string id)
    {
        // Return the TIFF bytes stored for this document.
        return Array.Empty<byte>();
    }

    public static string SaveTiff(string id, byte[] tiff)
    {
        // Write tiff under the caller's token. Return id, or a new key when the store assigns one.
        return id;
    }

    public static byte[] ToTiff(string fileName, byte[] upload)
    {
        // TIFF bytes pass through. A PDF becomes a multi-page TIFF before it is returned.
        return upload;
    }
}
```

## Annotations controller

```csharp
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace TiffViewer.Host;

[ApiController]
[Authorize]
[Route("api/documents/{id}/annotations")]
public sealed class AnnotationsController : ControllerBase
{
    [HttpGet]
    public ActionResult<DocumentAnnotations> GetAnnotations(string id)
    {
        var stamps = MockAnnotations.Find(id);
        if (stamps is null) return NotFound(new ApiError { Message = "Document not found." });
        return Ok(stamps);
    }
}

static class MockAnnotations
{
    public static DocumentAnnotations? Find(string id)
    {
        if (id is not ("1842" or "empty")) return null;
        return new DocumentAnnotations
        {
            DpiRequirement = 300,
            Editable = new List<EditableAnnotation>
            {
                new()
                {
                    Text = "Recorded\nthis date",
                    XPos = 150,
                    YPos = 200,
                    Width = 900,
                    Height = 160,
                    PageIndex = 0,
                    FontSize = 48,
                    AnnotationType = "VerbiageStamp",
                },
            },
            Uneditable = new List<UneditableAnnotation>
            {
                new()
                {
                    Text = "Uneditable annotation",
                    Left = 200,
                    Top = 420,
                    Width = 780,
                    Height = 160,
                    PageIndex = 0,
                    FontWeight = "bold",
                    IsFill = true,
                    FillColor = "#fff3a1",
                    IsStroke = true,
                    StrokeColor = "#1f3a68",
                    StrokeWidth = 2,
                },
            },
        };
    }
}
```

An empty document can still return stamps. The host adds them after a later `open-image`, once `document-loaded` fires. `editable` and `uneditable` are empty arrays when the document has no stamps:

```json
{ "dpiRequirement": 300, "editable": [], "uneditable": [] }
```

## Errors

Failures use one JSON object. `message` is what the host can pass to `save-failed` or show itself.

```json
{ "message": "No image found." }
```

| Status | When |
| --- | --- |
| `401` | The bearer token is missing or rejected by the host's existing authentication. |
| `404` | Unknown document id, or `GET .../tiff` when `imageExists` is false. |
| `400` | The TIFF body or the uploaded file is empty. |
| `415` | `PUT` was not sent as `image/tiff`. |

`GET .../image` with `"imageExists": false` is `200`. That is the signal for `image-missing`, not an HTTP error.
