/**
 * Prepares `dist/` for Cloudflare Pages:
 * - drops any file over Pages' 25 MiB limit (Dynamsoft Service installers: .msi / .pkg are ~30 MB).
 *   Scanning still works when the service is already installed; DWT can offer its own installer download.
 */
import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist'
const MAX_BYTES = 25 * 1024 * 1024

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else yield path
  }
}

let removed = 0
for (const file of walk(DIST)) {
  const size = statSync(file).size
  if (size <= MAX_BYTES) continue
  rmSync(file)
  removed++
  console.log(`Removed (over 25 MiB): ${file} (${(size / 1024 / 1024).toFixed(1)} MB)`)
}
if (removed === 0) console.log('No files over 25 MiB.')
