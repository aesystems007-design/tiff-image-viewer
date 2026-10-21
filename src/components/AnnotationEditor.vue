<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_SIZE,
  FONT_FAMILY,
  isEmptyText,
  richTextFromElement,
  richTextToHtml,
  TEXT_SIZES,
  type RichText,
} from '../annotations/richText'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  /** Text to start with (empty for a new annotation). */
  text: RichText
  isNew: boolean
}>()

const emit = defineEmits<{
  (e: 'save', text: RichText): void
  (e: 'cancel'): void
  (e: 'remove'): void
}>()

const editor = ref<HTMLDivElement>()
const empty = ref(isEmptyText(props.text))
/** Formatting at the caret, shown as active buttons / current size and color. */
const state = reactive({
  bold: false,
  italic: false,
  underline: false,
  align: 'left',
  size: DEFAULT_TEXT_SIZE,
  color: DEFAULT_TEXT_COLOR,
})
let savedRange: Range | null = null

function editorRange(): Range | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !editor.value) return null
  const range = selection.getRangeAt(0)
  return editor.value.contains(range.commonAncestorContainer) ? range : null
}

function onSelectionChange() {
  const range = editorRange()
  if (!range) return
  savedRange = range.cloneRange()
  state.bold = document.queryCommandState('bold')
  state.italic = document.queryCommandState('italic')
  state.underline = document.queryCommandState('underline')
  state.align = document.queryCommandState('justifyCenter') ? 'center' : document.queryCommandState('justifyRight') ? 'right' : 'left'
  const node = range.startContainer
  const element = node instanceof Element ? node : node.parentElement
  if (element) {
    const style = getComputedStyle(element)
    state.size = Math.round(Number.parseFloat(style.fontSize) * 0.75 * 2) / 2
    const rgb = style.color.match(/\d+/g)
    if (rgb) state.color = `#${rgb.slice(0, 3).map((c) => Number(c).toString(16).padStart(2, '0')).join('')}`
  }
}

/** Puts the caret/selection back after a toolbar control took focus, then runs the command. */
function exec(command: string, value?: string) {
  const el = editor.value
  if (!el) return
  el.focus()
  if (savedRange) {
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(savedRange)
  }
  document.execCommand('styleWithCSS', false, 'true')
  document.execCommand(command, false, value)
  onInput()
  onSelectionChange()
}

/**
 * With just a caret (nothing selected), puts the style on an empty span (holding a zero-width space) that
 * typing then fills: the browser forgets a pending size/color once focus has moved to the dropdown or picker.
 * Returns false when there is a selection, which the caller formats with execCommand.
 */
function styleAtCaret(style: Partial<CSSStyleDeclaration>): boolean {
  if (!savedRange?.collapsed || !editor.value) return false
  editor.value.focus()
  const span = document.createElement('span')
  Object.assign(span.style, style)
  span.textContent = '\u200b'
  savedRange.insertNode(span)
  const caret = document.createRange()
  caret.setStart(span.firstChild!, 1)
  caret.collapse(true)
  window.getSelection()?.removeAllRanges()
  window.getSelection()?.addRange(caret)
  onSelectionChange()
  return true
}

function setColor(color: string) {
  if (!styleAtCaret({ color })) exec('foreColor', color)
  state.color = color
}

// execCommand only knows the 7 HTML font sizes, so mark with the largest and swap in the real size.
function setSize(size: number) {
  state.size = size
  if (styleAtCaret({ fontSize: `${size}pt` })) return
  exec('fontSize', '7')
  editor.value?.querySelectorAll<HTMLElement>('font[size="7"], [style*="xxx-large"]').forEach((el) => {
    el.removeAttribute('size')
    el.style.fontSize = `${size}pt`
  })
}

function onInput() {
  if (editor.value) empty.value = (editor.value.textContent ?? '').replace(/\u200b/g, '').trim() === ''
}

function save() {
  if (!editor.value) return
  const text = richTextFromElement(editor.value)
  if (isEmptyText(text)) return
  emit('save', text)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('cancel')
  } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    save()
  }
}

onMounted(() => {
  const el = editor.value
  if (!el) return
  el.innerHTML = richTextToHtml(props.text)
  document.execCommand('defaultParagraphSeparator', false, 'div')
  document.addEventListener('selectionchange', onSelectionChange)
  el.focus()
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  window.getSelection()?.removeAllRanges()
  window.getSelection()?.addRange(range)
})

onBeforeUnmount(() => document.removeEventListener('selectionchange', onSelectionChange))
</script>

<template>
  <div class="backdrop" @pointerdown.self="emit('cancel')">
    <div class="annotation-editor" role="dialog" aria-label="Annotation text" @keydown="onKeydown">
      <div class="format" role="toolbar" aria-label="Text formatting">
        <button type="button" :class="{ active: state.bold }" title="Bold (Ctrl+B)" @mousedown.prevent @click="exec('bold')">
          <AppIcon name="bold" />
        </button>
        <button type="button" :class="{ active: state.italic }" title="Italic (Ctrl+I)" @mousedown.prevent @click="exec('italic')">
          <AppIcon name="italic" />
        </button>
        <button type="button" :class="{ active: state.underline }" title="Underline (Ctrl+U)" @mousedown.prevent @click="exec('underline')">
          <AppIcon name="underline" />
        </button>
        <span class="divider" />
        <select
          title="Font size (pt)"
          aria-label="Font size"
          :value="state.size"
          @change="setSize(Number(($event.target as HTMLSelectElement).value))"
        >
          <option v-if="!TEXT_SIZES.includes(state.size)" :value="state.size">{{ state.size }}</option>
          <option v-for="size in TEXT_SIZES" :key="size" :value="size">{{ size }}</option>
        </select>
        <label class="color" title="Text color">
          <AppIcon name="font" :style="{ borderBottomColor: state.color }" />
          <input type="color" aria-label="Text color" :value="state.color" @change="setColor(($event.target as HTMLInputElement).value)" />
        </label>
        <span class="divider" />
        <button type="button" :class="{ active: state.align === 'left' }" title="Align left" @mousedown.prevent @click="exec('justifyLeft')">
          <AppIcon name="align-left" />
        </button>
        <button type="button" :class="{ active: state.align === 'center' }" title="Center" @mousedown.prevent @click="exec('justifyCenter')">
          <AppIcon name="align-center" />
        </button>
        <button type="button" :class="{ active: state.align === 'right' }" title="Align right" @mousedown.prevent @click="exec('justifyRight')">
          <AppIcon name="align-right" />
        </button>
      </div>

      <div
        ref="editor"
        class="text"
        contenteditable="true"
        role="textbox"
        aria-multiline="true"
        aria-label="Annotation text"
        :data-placeholder="'Type the annotation…'"
        :class="{ empty }"
        :style="{ fontFamily: FONT_FAMILY, fontSize: `${DEFAULT_TEXT_SIZE}pt`, color: DEFAULT_TEXT_COLOR }"
        @input="onInput"
      />

      <div class="actions">
        <button v-if="!isNew" type="button" class="remove" title="Delete annotation" @click="emit('remove')">
          <AppIcon name="trash" /> Delete
        </button>
        <span class="spacer" />
        <button type="button" @click="emit('cancel')">Cancel</button>
        <button type="button" class="primary" :disabled="empty" title="Ctrl+Enter" @click="save">
          {{ isNew ? 'Add' : 'Save' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 3rem;
  background: rgb(0 0 0 / 25%);
}

.annotation-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: min(34rem, calc(100% - 2rem));
  padding: 6px;
  border: 1px solid #c9d1dd;
  border-radius: 6px;
  background: #fff;
  color: #1d2635;
  box-shadow: 0 6px 20px rgb(0 0 0 / 35%);
  font-size: 13px;
}

.format,
.actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.divider {
  width: 1px;
  height: 20px;
  margin: 0 4px;
  background: #c9d1dd;
}

.spacer {
  flex: 1;
}

button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 28px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  color: #1f3a68;
  font: inherit;
  cursor: pointer;
}

.format button {
  padding: 0;
}

button:hover:not(:disabled),
button.active {
  background: #e8eef8;
}

button.active {
  border-color: #1f3a68;
}

button.primary {
  min-width: 4.5rem;
  background: #3d64b5;
  color: #fff;
}

button.primary:hover:not(:disabled) {
  background: #3d64b5;
  filter: brightness(1.1);
}

button:disabled {
  opacity: 0.5;
  cursor: default;
}

button.remove {
  color: #a33a3a;
}

select {
  height: 28px;
  border: 1px solid #c9d1dd;
  border-radius: 4px;
  background: #fff;
  color: inherit;
  font: inherit;
}

.color {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  color: #1f3a68;
  cursor: pointer;
}

.color:hover {
  background: #e8eef8;
}

.color .app-icon {
  box-sizing: content-box;
  padding-bottom: 1px;
  border-bottom: 3px solid;
}

.color input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.text {
  position: relative;
  min-height: 7rem;
  max-height: 50vh;
  overflow: auto;
  padding: 8px;
  border: 1px solid #c9d1dd;
  border-radius: 4px;
  outline: none;
  line-height: 1.2;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.text:focus {
  border-color: #3d64b5;
}

.text.empty::before {
  content: attr(data-placeholder);
  position: absolute;
  color: #8a94a3;
  pointer-events: none;
}
</style>
