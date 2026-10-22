/**
 * Company label and colors for the toolbar Apply and Cancel buttons.
 * Set before mount with `window.tiffViewerActions`, or any time with `set-actions`.
 * A missing field is left as it is. `null` or `''` on a field restores that default.
 * `null` for the whole button restores all of its defaults.
 */
import { reactive } from 'vue'

export interface ActionBrand {
  label: string | null
  title: string | null
  background: string | null
  color: string | null
}

const EMPTY = (): ActionBrand => ({ label: null, title: null, background: null, color: null })

/** Null fields mean the built-in label and colors. */
export const actionBrands = reactive<{ apply: ActionBrand; cancel: ActionBrand }>({
  apply: EMPTY(),
  cancel: EMPTY(),
})

declare global {
  interface Window {
    /** Apply / Cancel label and colors, read once before the viewer mounts. */
    tiffViewerActions?: {
      apply?: unknown
      cancel?: unknown
    }
  }
}

const LABEL_MAX = 40
const TITLE_MAX = 120
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/** One button from the host. `null` restores it. An unusable value is ignored. */
export function actionBrandFromHost(value: unknown): Partial<ActionBrand> | null | undefined {
  if (value === null) return null
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const fields: Partial<ActionBrand> = {}
  if ('label' in raw) {
    const label = parseText(raw.label, LABEL_MAX)
    if (label !== undefined) fields.label = label
  }
  if ('title' in raw) {
    const title = parseText(raw.title, TITLE_MAX)
    if (title !== undefined) fields.title = title
  }
  if ('background' in raw) {
    const background = parseColor(raw.background)
    if (background !== undefined) fields.background = background
  }
  if ('color' in raw) {
    const color = parseColor(raw.color)
    if (color !== undefined) fields.color = color
  }
  return fields
}

/** Applies whichever of `apply` / `cancel` the object includes. */
export function setActionBrands(actions: { apply?: unknown; cancel?: unknown } | null | undefined) {
  if (!actions || typeof actions !== 'object') return
  if ('apply' in actions) writeBrand('apply', actionBrandFromHost(actions.apply))
  if ('cancel' in actions) writeBrand('cancel', actionBrandFromHost(actions.cancel))
}

function writeBrand(name: 'apply' | 'cancel', fields: Partial<ActionBrand> | null | undefined) {
  if (fields === undefined) return
  const target = actionBrands[name]
  if (fields === null) {
    Object.assign(target, EMPTY())
    return
  }
  if (fields.label !== undefined) target.label = fields.label
  if (fields.title !== undefined) target.title = fields.title
  if (fields.background !== undefined) target.background = fields.background
  if (fields.color !== undefined) target.color = fields.color
}

/** Plain text. `null` or blank restores the default. Anything else is ignored. */
function parseText(value: unknown, max: number): string | null | undefined {
  if (value === null || value === '') return null
  if (typeof value !== 'string') return undefined
  const text = value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return null
  return text.slice(0, max)
}

/** A hex or rgb/rgba color. `null` or blank restores the default. Anything else is ignored. */
function parseColor(value: unknown): string | null | undefined {
  if (value === null || value === '') return null
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (HEX.test(text)) return text.toLowerCase()
  const match = text.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d+))?\s*\)$/i,
  )
  if (!match) return undefined
  const channels = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (channels.some((channel) => channel > 255)) return undefined
  if (match[4] === undefined) return `rgb(${channels.join(', ')})`
  const alpha = Number(match[4])
  if (alpha > 1) return undefined
  return `rgba(${channels.join(', ')}, ${alpha})`
}
