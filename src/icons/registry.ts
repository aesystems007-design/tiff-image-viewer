/**
 * Company icon overrides. A value is either an image URL (png, jpeg, gif, webp, svg)
 * or one `<svg>` element. Null or '' restores the built-in icon.
 *
 * Set them before the app mounts with `window.tiffViewerIcons`, or any time with
 * `setIcons` / the host `set-icons` command.
 */
import { reactive } from 'vue'
import { isIconName, type IconName } from './icons'

const URL_VALUE = /^(https?:|data:image\/(?:png|jpe?g|gif|webp|svg\+xml)[;,])|^(\/|\.\/|\.\.\/)/i

/** Stored as a sanitized `<svg>` string, or `url:` plus the image address. */
export const iconOverrides = reactive<Partial<Record<IconName, string>>>({})

declare global {
  interface Window {
    /** Icon replacements read once, before the viewer mounts. */
    tiffViewerIcons?: Record<string, string | null>
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

function parseIconOverride(value: string): string | null {
  const text = value.trim()
  if (text.startsWith('<')) return sanitizeSvg(text)
  if (URL_VALUE.test(text) && !text.toLowerCase().includes('javascript:')) return `url:${text}`
  return null
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
