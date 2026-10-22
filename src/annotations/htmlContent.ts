/**
 * Custom HTML a host puts in an annotation, and image addresses used inline in the text.
 * Scripts and event handlers are dropped. CSS and `<img>` stay, so the box can render the markup.
 * The overlay draws the result in a shadow root, so its CSS does not leak into the viewer.
 */

const ALLOWED = new Set([
  'A', 'B', 'BLOCKQUOTE', 'BR', 'CAPTION', 'CODE', 'COL', 'COLGROUP', 'DIV', 'EM', 'FIGCAPTION', 'FIGURE',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'I', 'IMG', 'LI', 'OL', 'P', 'PRE', 'S', 'SMALL', 'SPAN',
  'STRONG', 'SUB', 'SUP', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'U', 'UL', 'STYLE',
])

/** Dropped whole, including their contents. */
const DROPPED = new Set(['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'FORM', 'SVG', 'MATH'])

const IMAGE_SRC = /^(?:https?:\/\/|data:image\/(?:png|jpe?g|gif|webp|bmp|svg\+xml)[;,])/i
const MAX_IMAGE_CHARS = 12_000_000

/** A data URL or http(s) image address, or null when it isn't one. */
export function annotationImageSource(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.length > MAX_IMAGE_CHARS) return null
  if (text.toLowerCase().includes('javascript:')) return null
  return IMAGE_SRC.test(text) ? text : null
}

/** Sanitized HTML, or null when there is nothing to draw. */
export function sanitizeAnnotationHtml(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  const doc = new DOMParser().parseFromString(text, 'text/html')
  // A `<style>` in a fragment is parked on the document head, not in the body.
  clean(doc.head)
  clean(doc.body)
  const styles = [...doc.head.querySelectorAll('style')].map((el) => el.outerHTML).join('')
  const html = (styles + doc.body.innerHTML).trim()
  return html || null
}

function clean(node: Node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.COMMENT_NODE) {
      if (child.nodeType === Node.COMMENT_NODE) child.remove()
      continue
    }
    if (!(child instanceof Element)) {
      child.remove()
      continue
    }
    const tag = child.tagName
    if (DROPPED.has(tag)) {
      child.remove()
      continue
    }
    if (!ALLOWED.has(tag)) {
      const parent = child.parentNode
      if (parent) {
        while (child.firstChild) parent.insertBefore(child.firstChild, child)
        child.remove()
      }
      continue
    }
    for (const attr of [...child.attributes]) {
      if (!keepAttribute(child, attr.name, attr.value)) child.removeAttribute(attr.name)
    }
    if (tag === 'STYLE') child.textContent = sanitizeCss(child.textContent ?? '')
    if (tag === 'IMG' && !annotationImageSource(child.getAttribute('src'))) {
      child.remove()
      continue
    }
    clean(child)
  }
}

function keepAttribute(el: Element, name: string, value: string): boolean {
  const attr = name.toLowerCase()
  if (attr.startsWith('on') || attr === 'srcdoc') return false
  if (attr === 'style') {
    el.setAttribute('style', sanitizeCss(value))
    return true
  }
  if (attr === 'src') return el.tagName === 'IMG' && !!annotationImageSource(value)
  if (attr === 'href') {
    const href = value.trim()
    return el.tagName === 'A' && (href.startsWith('#') || /^https?:\/\//i.test(href) || /^mailto:/i.test(href))
  }
  return attr === 'class' || attr === 'id' || attr === 'title' || attr === 'alt' || attr === 'colspan' || attr === 'rowspan' || attr === 'align' || attr === 'width' || attr === 'height' || attr === 'cellpadding' || attr === 'cellspacing' || attr === 'border'
}

/** Drops CSS that can load or run something. `url()` of an image is kept. */
function sanitizeCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/expression\s*\(/gi, '(')
    .replace(/javascript\s*:/gi, '')
    .replace(/behavior\s*:/gi, '')
    .replace(/-moz-binding\s*:/gi, '')
    .replace(/url\s*\(\s*(['"]?)\s*(?!data:image\/|https?:\/\/|blob:)/gi, 'url($1')
}
