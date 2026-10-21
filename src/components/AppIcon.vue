<script setup lang="ts">
import { computed } from 'vue'
import { builtinIcon, type IconName } from '../icons/icons'
import { iconOverrides } from '../icons/registry'

const props = defineProps<{
  name: IconName
  /** Continuous rotation, for the loading spinner. */
  spin?: boolean
}>()

const view = computed(() => {
  const override = iconOverrides[props.name]
  if (!override) return { kind: 'svg' as const, value: builtinIcon(props.name) }
  if (override.startsWith('url:')) return { kind: 'url' as const, value: override.slice(4) }
  return { kind: 'svg' as const, value: override }
})
</script>

<template>
  <img v-if="view.kind === 'url'" class="app-icon" :class="{ spin }" :src="view.value" alt="" />
  <span v-else class="app-icon" :class="{ spin }" v-html="view.value" />
</template>

<style scoped>
.app-icon {
  display: inline-block;
  width: 1em;
  height: 1em;
  flex: 0 0 auto;
  vertical-align: -0.125em;
}

.app-icon :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
}

.spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
