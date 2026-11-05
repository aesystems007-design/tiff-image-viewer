<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import type { Editor } from 'hugerte'
import { isEmptyText, richTextFromElement, richTextToHtml, type RichText } from '../annotations/richText'
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

const mount = ref<HTMLElement>()
const editor = shallowRef<Editor | null>(null)
const ready = ref(false)
const failed = ref(false)
const empty = ref(true)
let destroyed = false

function refreshEmpty() {
  const current = editor.value
  if (!current) return
  const text = current.getContent({ format: 'text' }).replace(/\u00a0/g, ' ').trim()
  empty.value = text === '' && current.getBody()?.querySelector('img') == null
}

function save() {
  const current = editor.value
  if (!current || !ready.value) return
  const text = richTextFromElement(current.getBody())
  if (isEmptyText(text)) return
  emit('save', text)
}

function close() {
  queueMicrotask(() => emit('cancel'))
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    if (document.querySelector('.tox-dialog')) return
    event.preventDefault()
    close()
  } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    save()
  }
}

onMounted(async () => {
  const target = mount.value
  if (!target) return
  try {
    const { mountAnnotationEditor } = await import('../annotations/hugerteEditor')
    if (destroyed) return
    const instance = await mountAnnotationEditor(target, {
      html: richTextToHtml(props.text),
      onChange: refreshEmpty,
      onEscape: close,
      onSave: save,
    })
    if (destroyed) {
      instance.remove()
      return
    }
    editor.value = instance
    ready.value = true
    refreshEmpty()
  } catch (err) {
    console.error(err)
    if (!destroyed) failed.value = true
  }
})

onBeforeUnmount(() => {
  destroyed = true
  editor.value?.remove()
  editor.value = null
})
</script>

<template>
  <div class="backdrop" @pointerdown.self="close">
    <div class="annotation-editor" role="dialog" aria-label="Annotation text" @keydown="onKeydown">
      <p v-if="!ready && !failed" class="status">Loading editor…</p>
      <p v-if="failed" class="status failed">The editor could not be loaded.</p>
      <div v-show="!failed" ref="mount" class="mount" />

      <div class="actions">
        <button v-if="!isNew" type="button" class="remove" title="Delete annotation" @click="emit('remove')">
          <AppIcon name="trash" /> Delete
        </button>
        <span class="spacer" />
        <button type="button" @click="close">Cancel</button>
        <button type="button" class="primary" :disabled="!ready || empty" title="Ctrl+Enter" @click="save">
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
  width: min(40rem, calc(100% - 2rem));
  padding: 6px;
  border: 1px solid #c9d1dd;
  border-radius: 6px;
  background: #fff;
  color: #1d2635;
  box-shadow: 0 6px 20px rgb(0 0 0 / 35%);
  font-size: 13px;
}

.mount {
  min-height: 16rem;
}

.mount :deep(.tox-hugerte) {
  border: 1px solid #c9d1dd;
  border-radius: 4px;
}

.status {
  margin: 0;
  padding: 8px;
  color: #8a94a3;
}

.status.failed {
  color: #a33a3a;
}

.actions {
  display: flex;
  align-items: center;
  gap: 2px;
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

button:hover:not(:disabled) {
  background: #e8eef8;
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
</style>
