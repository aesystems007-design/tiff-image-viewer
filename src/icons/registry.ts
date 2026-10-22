/**
 * Company icon overrides. A value is an image URL (png, jpeg, gif, webp, svg), one `<svg>` element,
 * or one Font Awesome `<i>` tag (`<i class="fa-solid fa-print"></i>`). Null or '' restores the built-in icon.
 *
 * The `<i>` tag needs the company's Font Awesome CSS or kit inside this page: `window.tiffViewerIconFont`
 * before the app mounts, or `iconFont` on `set-icons`. A `.js` URL is the kit script; anything else is a stylesheet.
 *
 * Set icons before the app mounts with `window.tiffViewerIcons`, or any time with
 * `setIcons` / the host `set-icons` command.
 */
import { reactive } from 'vue'
import { isIconName, type IconName } from './icons'

const URL_VALUE = /^(https?:|data:image\/(?:png|jpe?g|gif|webp|svg\+xml)[;,])|^(\/|\.\/|\.\.\/)/i
const FONT_URL = /^(https?:|\/|\.\/|\.\.\/)/i
const FONT_LINK_ID = 'tiff-viewer-icon-font'

/** Stored as a sanitized `<svg>` or `<i>` string, or `url:` plus the image address. */
export const iconOverrides = reactive<Partial<Record<IconName, string>>>({})

declare global {
  interface Window {
    /** Icon replacements read once, before the viewer mounts. */
    tiffViewerIcons?: Record<string, string | null>
    /**
     * Font Awesome stylesheet or kit script for `<i>` icon overrides.
     * A `.js` URL is inserted as a script; any other URL is a stylesheet.
     */
    tiffViewerIconFont?: string | null
  }
}

/** Replace any built-in icons. Unknown names and values that are not an SVG or image URL are skipped. */
export function setIcons(icons: Record<string, string | null | undefined>) {
  for (const [name, value] of Object.entries(icons)) {
    if (!isIconName(name)) continue
    if (value == null || value.trim() === '') {
      delete iconOverrides[name]
      continue
    }
    const parsed = parseIconOverride(value)
    if (parsed) iconOverrides[name] = parsed
  }
}

/**
 * Loads the company's Font Awesome CSS or kit so `<i>` overrides draw.
 * `null` or `''` removes it. A URL that is not http(s) or a site path is ignored.
 */
export function setIconFont(url: string | null | undefined) {
  document.getElementById(FONT_LINK_ID)?.remove()
  const href = url?.trim() ?? ''
  if (!href || !FONT_URL.test(href) || href.toLowerCase().includes('javascript:')) return
  if (/\.js(\?|#|$)/i.test(href)) {
    const script = document.createElement('script')
    script.id = FONT_LINK_ID
    script.src = href
    script.crossOrigin = 'anonymous'
    document.head.appendChild(script)
    return
  }
  const link = document.createElement('link')
  link.id = FONT_LINK_ID
  link.rel = 'stylesheet'
  link.href = href
  document.head.appendChild(link)
}

function parseIconOverride(value: string): string | null {
  const text = value.trim()
  if (text.startsWith('<')) return sanitizeIconMarkup(text)
  if (URL_VALUE.test(text) && !text.toLowerCase().includes('javascript:')) return `url:${text}`
  return null
}

/** One `<svg>` or one empty `<i class="...">`. Anything else is ignored. */
function sanitizeIconMarkup(markup: string): string | null {
  const doc = new DOMParser().parseFromString(markup, 'text/html')
  const root = doc.body.firstElementChild
  if (!root || doc.body.childElementCount !== 1) return null
  const tag = root.tagName.toLowerCase()
  if (tag === 'svg') return sanitizeSvg(markup)
  if (tag === 'i') return sanitizeFontIcon(root)
  return null
}

/** Class tokens only, so a Font Awesome `<i>` cannot carry a script or handler. */
function sanitizeFontIcon(el: Element): string | null {
  if (el.children.length > 0 || (el.textContent ?? '').trim() !== '') return null
  const classes = (el.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean)
  if (classes.length === 0 || classes.some((name) => !/^[\w:-]+$/.test(name))) return null
  const icon = document.createElement('i')
  icon.setAttribute('class', classes.join(' '))
  icon.setAttribute('aria-hidden', 'true')
  return icon.outerHTML
}

/** Keep a single `<svg>` and drop scripts, event handlers, and embedded documents. */
function sanitizeSvg(markup: string): string | null {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
  const svg = doc.documentElement
  if (svg.tagName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return null
  for (const el of svg.querySelectorAll('script, foreignObject, iframe, object, embed')) el.remove()
  const scrub = (el: Element) => {
    for (const attr of [...el.attributes]) {
      const attrName = attr.name.toLowerCase()
      const attrValue = attr.value.trim().toLowerCase()
      if (attrName.startsWith('on') || attrValue.startsWith('javascript:') || attrValue.startsWith('data:text')) {
        el.removeAttribute(attr.name)
      }
    }
    for (const child of [...el.children]) scrub(child)
  }
  scrub(svg)
  svg.setAttribute('width', '100%')
  svg.setAttribute('height', '100%')
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  return svg.outerHTML
}
