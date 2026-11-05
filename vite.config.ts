import { cpSync, createReadStream, readFileSync, statSync } from 'node:fs'
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
/**
 * HugeRTE's skins, theme and plugins call the global `hugerte` (the core sets `window.hugerte`).
 * Bundled as ES modules, that name is not the window, so each of those files gets the global first.
 */
function hugerteGlobal(): Plugin {
  return {
    name: 'hugerte-global',
    enforce: 'pre',
    transform(code, id) {
      const path = id.split('?')[0].replace(/\\/g, '/')
      if (!path.includes('/node_modules/hugerte/') || !path.endsWith('.js')) return
      if (/\/hugerte(?:\.min)?\.js$/.test(path)) return
      if (!code.includes('hugerte.') || code.startsWith('var hugerte = window.hugerte')) return
      return { code: `var hugerte = window.hugerte;\n${code}`, map: null }
    },
  }
}

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
  plugins: [vue(), hugerteGlobal(), dwtResources()],
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
    include: [
      'utif',
      'dwt',
      'hugerte',
      'hugerte/icons/default',
      'hugerte/models/dom',
      'hugerte/themes/silver',
      'hugerte/skins/ui/oxide/skin.js',
      'hugerte/skins/ui/oxide/content.js',
      'hugerte/skins/content/default/content.js',
      'hugerte/plugins/image',
    ],
    // Dev prebundles these with esbuild, which does not run hugerteGlobal. Give the skins the same global there.
    esbuildOptions: {
      plugins: [
        {
          name: 'hugerte-global',
          setup(build) {
            build.onLoad({ filter: /[\\/]node_modules[\\/]hugerte[\\/].+\.js$/ }, (args) => {
              if (/[\\/]hugerte(?:\.min)?\.js$/.test(args.path)) return
              const source = readFileSync(args.path, 'utf8')
              if (!source.includes('hugerte.') || source.startsWith('var hugerte = window.hugerte')) return
              return { contents: `var hugerte = window.hugerte;\n${source}`, loader: 'js' }
            })
          },
        },
      ],
    },
  },
})
