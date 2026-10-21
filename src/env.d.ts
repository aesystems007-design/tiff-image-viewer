/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Dynamic Web TWAIN licence (product key), for scanning. */
  readonly VITE_DWT_PRODUCT_KEY?: string
  /** URL of the Dynamic Web TWAIN resources folder; defaults to the copy served at /dwt-resources. */
  readonly VITE_DWT_RESOURCES_PATH?: string
  /** Origin of the hosting app (e.g. https://app.example.com); events are posted only there. Default: any. */
  readonly VITE_HOST_ORIGIN?: string
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
