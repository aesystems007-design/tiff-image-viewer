<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { ExportFormat } from '../tiff/protocol'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  /** Suggested file name, without extension. */
  defaultName: string
  pageCount: number
}>()

const emit = defineEmits<{
  (e: 'download', fileName: string, format: ExportFormat): void
  (e: 'cancel'): void
}>()

const EXTENSIONS: Record<ExportFormat, string> = { pdf: '.pdf', tiff: '.tif' }

const name = ref(props.defaultName)
const format = ref<ExportFormat>('pdf')
const nameInput = ref<HTMLInputElement>()

/** Characters Windows and macOS don't allow in file names. */
const cleanName = computed(() => name.value.replace(/[\\/:*?"<>|]/g, '').trim())
/** The name with the type's extension (an extension already typed for that type is kept). */
const fileName = computed(() => {
  const base = cleanName.value
  const known = format.value === 'pdf' ? /\.pdf$/i : /\.tiff?$/i
  return known.test(base) ? base : `${base}${EXTENSIONS[format.value]}`
})

onMounted(() => {
  nameInput.value?.focus()
  nameInput.value?.select()
})

function submit() {
  if (cleanName.value) emit('download', fileName.value, format.value)
}
</script>

<template>
  <div class="backdrop" @pointerdown.self="emit('cancel')">
    <form
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="download-title"
      @submit.prevent="submit"
      @keydown.esc.prevent="emit('cancel')"
    >
      <h2 id="download-title"><AppIcon name="download" /> Download to PC</h2>
      <label class="field">
        <span>File name</span>
        <input ref="nameInput" v-model="name" type="text" spellcheck="false" autocomplete="off" />
      </label>
      <fieldset class="field">
        <legend>Type</legend>
        <label class="choice"><input v-model="format" type="radio" value="pdf" /> PDF</label>
        <label class="choice"><input v-model="format" type="radio" value="tiff" /> TIFF</label>
      </fieldset>
      <p class="summary">
        {{ pageCount }} {{ pageCount === 1 ? 'page' : 'pages' }} as <strong>{{ cleanName ? fileName : '…' }}</strong>
      </p>
      <div class="actions">
        <button type="button" class="cancel" @click="emit('cancel')">Cancel</button>
        <button type="submit" class="download" :disabled="!cleanName">Download</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 45%);
}

.dialog {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  width: min(26rem, calc(100vw - 2rem));
  padding: 1.1rem 1.25rem;
  border: 1px solid #c9d1dd;
  border-radius: 8px;
  background: #fff;
  color: #1d2635;
  box-shadow: 0 10px 30px rgb(0 0 0 / 35%);
}

h2 {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  color: #1f3a68;
  font-size: 1.1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin: 0;
  padding: 0;
  border: none;
  font-size: 0.9rem;
}

.field input[type='text'] {
  padding: 0.4rem 0.5rem;
  border: 1px solid #c9d1dd;
  border-radius: 4px;
  font: inherit;
}

.field input[type='text']:focus {
  outline: 2px solid #3d64b5;
  outline-offset: -1px;
}

legend {
  margin-bottom: 0.3rem;
  padding: 0;
}

.choice {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-right: 1.25rem;
}

fieldset.field {
  flex-direction: row;
  flex-wrap: wrap;
}

legend {
  width: 100%;
}

.summary {
  margin: 0;
  color: #4a5568;
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.actions button {
  padding: 0.4rem 1rem;
  border: none;
  border-radius: 4px;
  color: #fff;
  font: inherit;
  cursor: pointer;
}

.download {
  background: #3d64b5;
}

.download:disabled {
  opacity: 0.5;
  cursor: default;
}

.cancel {
  background: #6b7686;
}
</style>
