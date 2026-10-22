/**
 * Which toolbar buttons a company shows. Separate from icon replacement: several buttons share one icon
 * (the thin one acts on the selected pages, the large one on all pages).
 *
 * Set before mount with `window.tiffViewerButtons`, or any time with `set-buttons`.
 * `false` hides a button. `true`, `null`, or `''` shows it again. A name left out is left as it is.
 * Unknown names are ignored. Every button starts visible.
 */
import { reactive } from 'vue'

export const TOOLBAR_BUTTONS = [
  'sidebar',
  'undo',
  'print',
  'download',
  'insert',
  'scan',
  'delete',
  'rotate-left',
  'rotate-right',
  'rotate-left-all',
  'rotate-right-all',
  'move-down',
  'move-up',
  'select-area',
  'brightness',
  'despeckle',
  'despeckle-all',
  'scale-up',
  'scale-up-all',
  'scale-down',
  'scale-down-all',
  'apply',
  'cancel',
  'letter',
  'letter-all',
  'legal',
  'legal-all',
  'page-nav',
  'zoom',
  'fit-page',
  'fit-width',
  'fit-actual',
  'fullscreen',
  'white-out',
  'white-out-all',
  'erase',
  'reposition',
  'deskew',
  'deskew-all',
] as const

export type ToolbarButton = (typeof TOOLBAR_BUTTONS)[number]

const BUTTON_NAMES = new Set<string>(TOOLBAR_BUTTONS)

export function isToolbarButton(name: string): name is ToolbarButton {
  return BUTTON_NAMES.has(name)
}

/** `true` means the button is shown. */
export const toolbarButtons = reactive<Record<ToolbarButton, boolean>>(defaultButtons())

declare global {
  interface Window {
    /** Toolbar buttons to hide or show, read once before the viewer mounts. */
    tiffViewerButtons?: Record<string, boolean | null>
  }
}

export function toolbarButtonShown(name: ToolbarButton): boolean {
  return toolbarButtons[name]
}

/**
 * Applies the buttons named in `buttons`. `false` hides one. `true`, `null`, or `''` shows it.
 * Anything else, and any unknown name, is skipped.
 */
export function setToolbarButtons(buttons: Record<string, unknown> | null | undefined) {
  if (!buttons || typeof buttons !== 'object') return
  for (const [name, value] of Object.entries(buttons)) {
    if (!isToolbarButton(name)) continue
    if (value === false) toolbarButtons[name] = false
    else if (value === true || value === null || value === '') toolbarButtons[name] = true
  }
}

function defaultButtons(): Record<ToolbarButton, boolean> {
  return Object.fromEntries(TOOLBAR_BUTTONS.map((name) => [name, true])) as Record<ToolbarButton, boolean>
}
