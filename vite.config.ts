import { cpSync, createReadStream, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

const DWT_RESOURCES = fileURLToPath(new URL('./node_modules/dwt/dist', import.meta.url))
const DWT_URL = 'dwt-resources'
const MIME_TYPES: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' }

/**
 * Dynamic Web TWAIN loads its CSS, wasm, helper scripts and the service installers from `ResourcesPath` at run
 * time, so its resource folder is served at /dwt-resources in dev and the parts it needs are copied there on build.
 */
function dwtResources(): Plugin {
  let outDir = ''
  let building = false
  return {
    name: 'dwt-resources',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
      building = config.command === 'build'
    },
    configureServer(server) {
      server.middlewares.use(`/${DWT_URL}`, (req, res, next) => {
        const file = join(DWT_RESOURCES, decodeURIComponent((req.url ?? '/').split('?')[0]))
        if (!file.startsWith(DWT_RESOURCES + sep) || !statSync(file, { throwIfNoEntry: false })?.isFile()) return next()
        res.setHeader('Content-Type', MIME_TYPES[extname(file)] ?? 'application/octet-stream')
        createReadStream(file).pipe(res)
      })
    },
    closeBundle() {
      if (!building) return
      // addon/ is OCR / barcode / camera, which we don't use, but DWT still loads the camera CSS on start.
      for (const path of ['src', 'dist', 'addon/dynamsoft.webtwain.addon.camera.css']) {
        cpSync(join(DWT_RESOURCES, path), join(outDir, DWT_URL, path), { recursive: true })
      }
    },
  }
}

export default defineConfig({
  plugins: [vue(), dwtResources()],
  build: {
    // Dynamic Web TWAIN is a 1.8 MB chunk of its own, loaded only when the user scans.
    chunkSizeWarningLimit: 1900,
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // utif is only imported from the worker and dwt only lazily, so the dependency scanner won't find them on
    // its own (dwt would be optimized on the first scan, reloading the page).
    include: ['utif', 'dwt'],
  },
})
