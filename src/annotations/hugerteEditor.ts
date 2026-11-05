import type { Editor, HugeRTE } from 'hugerte'
import { annotationImageSource } from './htmlContent'
import { DEFAULT_TEXT_COLOR, DEFAULT_TEXT_SIZE, FONT_FAMILY, LINE_HEIGHT, TEXT_SIZES } from './richText'

// The core assigns window.hugerte. Skins, the theme and plugins then read that global,
// so this import has to be evaluated before the ones below.
import 'hugerte'
import 'hugerte/icons/default'
import 'hugerte/models/dom'
import 'hugerte/themes/silver'
import 'hugerte/skins/ui/oxide/skin.js'
import 'hugerte/skins/ui/oxide/content.js'
import 'hugerte/skins/content/default/content.js'
import 'hugerte/plugins/image'

declare global {
  interface Window {
    hugerte?: HugeRTE
  }
}

/** A picture larger than this is refused. The stored data URL also has to fit annotationImageSource. */
const MAX_IMAGE_BYTES = 6_000_000

export interface AnnotationEditorHandlers {
  html: string
  onChange: () => void
  onEscape: () => void
  onSave: () => void
}

function api(): HugeRTE {
  const value = window.hugerte
  if (!value || typeof value.init !== 'function') throw new Error('HugeRTE did not load.')
  return value
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image.'))
    reader.readAsDataURL(blob)
  })
}

function rejectLargeImage(editor: Editor) {
  editor.notificationManager.open({ text: 'The image is too large.', type: 'error' })
}

function isKeyEvent(event: unknown): event is KeyboardEvent {
  return !!event && typeof event === 'object' && 'key' in event && typeof event.key === 'string'
}

/** Opens HugeRTE on `target`. The caller removes the editor when the popup closes. */
export async function mountAnnotationEditor(target: HTMLElement, handlers: AnnotationEditorHandlers): Promise<Editor> {
  const hugerte = api()
  const editors = await hugerte.init({
    target,
    height: 280,
    width: '100%',
    menubar: false,
    statusbar: false,
    branding: false,
    resize: false,
    elementpath: false,
    contextmenu: false,
    toolbar_mode: 'wrap',
    browser_spellcheck: true,
    deprecation_warnings: false,
    plugins: 'image',
    toolbar: 'bold italic underline | fontsize forecolor | alignleft aligncenter alignright | image',
    font_size_formats: TEXT_SIZES.map((size) => `${size}pt`).join(' '),
    placeholder: 'Type the annotation…',
    skin_url: 'default',
    content_css: 'default',
    content_style: [
      `body { font-family: ${FONT_FAMILY}; font-size: ${DEFAULT_TEXT_SIZE}pt; line-height: ${LINE_HEIGHT}; color: ${DEFAULT_TEXT_COLOR}; margin: 8px; }`,
      'p { margin: 0; }',
      'img { vertical-align: middle; }',
    ].join(' '),
    object_resizing: true,
    paste_data_images: true,
    automatic_uploads: true,
    convert_urls: false,
    relative_urls: false,
    images_file_types: 'jpeg,jpg,png,gif,webp,bmp',
    extended_valid_elements: 'img[src|alt|width|height|style|data-width|data-height]',
    invalid_elements: 'script,iframe,object,embed,link,meta',
    file_picker_types: 'image',
    images_upload_handler: async (blobInfo) => {
      const blob = blobInfo.blob()
      if (blob.size > MAX_IMAGE_BYTES) throw new Error('The image is too large.')
      const src = annotationImageSource(await blobToDataUrl(blob))
      if (!src) throw new Error('That image cannot be used.')
      return src
    },
    file_picker_callback: (callback, _value, meta) => {
      if (meta.filetype && meta.filetype !== 'image') return
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/bmp'
      input.onchange = () => {
        const file = input.files?.[0]
        const editor = hugerte.activeEditor
        if (!file || !editor) return
        if (file.size > MAX_IMAGE_BYTES) {
          rejectLargeImage(editor)
          return
        }
        const reader = new FileReader()
        reader.onload = () => {
          const src = annotationImageSource(reader.result)
          if (src) callback(src, { alt: '' })
          else rejectLargeImage(editor)
        }
        reader.readAsDataURL(file)
      }
      input.click()
    },
    setup: (editor) => {
      editor.on('init', () => {
        editor.setContent(handlers.html)
        editor.focus()
        editor.selection.select(editor.getBody(), true)
        editor.selection.collapse(false)
        handlers.onChange()
      })
      editor.on('input change undo redo SetContent NodeChange ObjectResized', () => handlers.onChange())
      editor.on('keydown', (event) => {
        if (!isKeyEvent(event)) return
        if (event.key === 'Escape') {
          if (document.querySelector('.tox-dialog')) return
          event.preventDefault()
          handlers.onEscape()
        } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          handlers.onSave()
        }
      })
    },
  })
  const editor = editors[0]
  if (!editor) throw new Error('HugeRTE did not start.')
  return editor
}
