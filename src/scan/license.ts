/**
 * Dynamic Web TWAIN product key. A company sets its own licence; with none, scanning is unavailable
 * and the scan button is not shown.
 *
 * The build-time `VITE_DWT_PRODUCT_KEY` is the default. Replace it before the app mounts with
 * `window.tiffViewerScanLicense`, or any time with `setScanLicense` / the host `set-scan-license` command.
 * An empty value hides scanning even when the build had a key.
 */
import { computed, ref } from 'vue'

const productKey = ref((import.meta.env.VITE_DWT_PRODUCT_KEY ?? '').trim())

/** True when a non-empty product key is set. */
export const canScan = computed(() => productKey.value.length > 0)

export function scanProductKey(): string {
  return productKey.value
}

/** Set the company's product key. Null or '' hides the scan button. */
export function setScanLicense(key: string | null | undefined) {
  productKey.value = (key ?? '').trim()
}

declare global {
  interface Window {
    /** Product key read once, before the viewer mounts. Empty hides scanning. */
    tiffViewerScanLicense?: string | null
  }
}
