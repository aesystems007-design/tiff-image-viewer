/**
 * Built-in toolbar and chrome icons. Names are the public ids a host overrides
 * (`setIcons` / `window.tiffViewerIcons` / the `set-icons` command).
 * Stroke icons use `currentColor` so they follow the toolbar color.
 */

function stroke(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
}

function fill(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${body}</svg>`
}

function glyph(letter: string, extra = ''): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><text x="12" y="17" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="currentColor" ${extra}>${letter}</text></svg>`
}

export const ICONS = {
  sidebar: stroke('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>'),
  undo: stroke('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H12"/>'),
  print: stroke('<path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/>'),
  download: stroke('<path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>'),
  insert: stroke('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 18v-6"/><path d="m9 15 3-3 3 3"/>'),
  stamp: stroke('<rect x="5" y="3" width="14" height="9" rx="1.5"/><path d="M8 12v2.5a4 4 0 0 0 8 0V12"/><path d="M7 21h10"/><path d="M8 7h8M8 9.5h5"/>'),
  scan: stroke('<path d="M7 3H5a2 2 0 0 0-2 2v2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M17 21h2a2 2 0 0 0 2-2v-2"/><path d="M3 12h18"/>'),
  trash: stroke('<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M7 7l1 13h8l1-13"/>'),
  'rotate-left': stroke('<path d="M4 11a8 8 0 1 0 2.3-5.7"/><path d="M4 4v5h5"/>'),
  'rotate-right': stroke('<path d="M20 11a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>'),
  'move-down': stroke('<path d="M6 3h12v18H6z"/><path d="M12 8v8"/><path d="m8 13 4 4 4-4"/>'),
  'move-up': stroke('<path d="M6 3h12v18H6z"/><path d="M12 16V8"/><path d="m8 11 4-4 4 4"/>'),
  'select-area': stroke('<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 2.5"/>'),
  brightness: stroke('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>'),
  contrast: stroke('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/>'),
  despeckle: fill(
    '<circle cx="6" cy="6" r="1.4"/><circle cx="12" cy="6" r="1.4"/><circle cx="18" cy="6" r="1.4"/><circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/><circle cx="6" cy="18" r="1.4"/><circle cx="12" cy="18" r="1.4"/><circle cx="18" cy="18" r="1.4"/>',
  ),
  'scale-up': stroke('<path d="M12 19V6"/><path d="m7 11 5-5 5 5"/><path d="M5 19h4M15 15h4"/>'),
  'scale-down': stroke('<path d="M12 5v13"/><path d="m7 13 5 5 5-5"/><path d="M5 5h4M15 9h4"/>'),
  spinner: stroke('<path d="M12 3a9 9 0 1 1-6.4 2.6"/>'),
  'caret-left': fill('<path d="M14.5 5 7 12l7.5 7z"/>'),
  'caret-right': fill('<path d="M9.5 5 17 12l-7.5 7z"/>'),
  'zoom-in': stroke('<circle cx="10.5" cy="10.5" r="6"/><path d="m20 20-4-4M10.5 8v5M8 10.5h5"/>'),
  'zoom-out': stroke('<circle cx="10.5" cy="10.5" r="6"/><path d="m20 20-4-4M8 10.5h5"/>'),
  'fit-page': stroke('<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/>'),
  'fit-width': stroke('<path d="M8 4v16M16 4v16M8 12H2.5M5 9 2.5 12 5 15M16 12h5.5M19 9l2.5 3L19 15"/>'),
  'fit-actual': stroke('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  fullscreen: stroke('<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/><path d="m4 4 4.5 4.5M20 4l-4.5 4.5M4 20l4.5-4.5M20 20l-4.5-4.5"/>'),
  'fullscreen-exit': stroke('<path d="M4 9h5V4M15 9h5V4M4 15h5v5M15 15h5v5"/><path d="m9 9-4.5-4.5M15 9l4.5-4.5M9 15l-4.5 4.5M15 15l4.5 4.5"/>'),
  letter: stroke('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 12h6M10 16h6"/>'),
  legal: stroke('<path d="M8 2h6l4 4v16H8z"/><path d="M14 2v4h4"/>'),
  'white-out': stroke('<path d="M5 3h14v18H5z"/><path d="M5 3h14v4H5z" fill="currentColor" stroke="none"/>'),
  eraser: stroke('<path d="m16 4 4 4-9 9H7l-3-3 9-9z"/><path d="M5 21h14"/>'),
  reposition: stroke('<path d="M12 3v18M3 12h18"/><path d="m8 7 4-4 4 4M8 17l4 4 4-4M7 8 3 12l4 4M17 8l4 4-4 4"/>'),
  deskew: stroke('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h5M10 17h5"/>'),
  warning: stroke('<path d="M12 3 2.5 20h19z"/><path d="M12 9v5"/><path d="M12 17h.01"/>'),
  'chevron-down': stroke('<path d="m6 9 6 6 6-6"/>'),
  checkbox: stroke('<rect x="4" y="4" width="16" height="16" rx="2"/>'),
  'checkbox-on': stroke('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="m8 12 3 3 5-6"/>'),
  bold: glyph('B'),
  italic: glyph('I', 'font-style="italic"'),
  underline: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><text x="12" y="16" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="currentColor">U</text><path d="M6 20h12" stroke="currentColor" stroke-width="2"/></svg>`,
  font: glyph('A'),
  'align-left': stroke('<path d="M4 6h16M4 10h10M4 14h16M4 18h8"/>'),
  'align-center': stroke('<path d="M4 6h16M7 10h10M4 14h16M8 18h8"/>'),
  'align-right': stroke('<path d="M4 6h16M10 10h10M4 14h16M12 18h8"/>'),
  edit: stroke('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>'),
  close: stroke('<path d="M6 6l12 12M18 6 6 18"/>'),
} as const

export type IconName = keyof typeof ICONS

export function isIconName(name: string): name is IconName {
  return Object.prototype.hasOwnProperty.call(ICONS, name)
}

export function builtinIcon(name: IconName): string {
  return ICONS[name]
}
