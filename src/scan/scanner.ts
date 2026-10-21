import type { WebTwain } from 'dwt/dist/types/WebTwain'
import { scanProductKey } from './license'

type Dynamsoft = typeof import('dwt').default

/** Where the DWT resources (CSS, wasm, helper scripts, service installers) are served; see vite.config.ts. */
const RESOURCES_PATH = import.meta.env.VITE_DWT_RESOURCES_PATH || `${import.meta.env.BASE_URL}dwt-resources`

let loading: Promise<{ dynamsoft: Dynamsoft; twain: WebTwain }> | null = null
/** Key the open connection was created with, so a new licence is not reused on an old object. */
let connectedKey = ''

/**
 * Loads Dynamic Web TWAIN (only when the user first scans) and connects to the local Dynamsoft Service.
 * When the service isn't installed, DWT shows its own download/install dialog and this rejects.
 */
function connect() {
  const productKey = scanProductKey()
  if (!productKey) throw new Error('Scanning is not licensed.')
  if (loading && connectedKey !== productKey) loading = null
  loading ??= (async () => {
    connectedKey = productKey
    const { default: dynamsoft } = await import('dwt')
    dynamsoft.DWT.ProductKey = productKey
    dynamsoft.DWT.ResourcesPath = RESOURCES_PATH
    const twain = await new Promise<WebTwain>((resolve, reject) =>
      dynamsoft.DWT.CreateDWTObjectEx({ WebTwainId: 'tiff-scanner' }, resolve, (error) =>
        reject(new Error(error || 'The Dynamsoft Service is not running on this computer.')),
      ),
    )
    // DWT 17 builds its progress dialog only when a viewer is bound or Dynamsoft.DWT.Load() runs; without it
    // ConvertToBlob throws ("appendChild ... not of type 'Node'"). Lib isn't in the typings.
    const { Lib } = dynamsoft as unknown as { Lib: { initProgress(): void } }
    Lib.initProgress()
    return { dynamsoft, twain }
  })().catch((err) => {
    loading = null
    throw err
  })
  return loading
}

function message(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) return String(err.message)
  return String(err)
}

function isCancel(err: unknown) {
  return /cancel/i.test(message(err))
}

/**
 * Scans with the scanner driver's own dialog. DWT 17's AcquireImage callback can come before the pages are
 * transferred, so the scan counts as done when all transfers are in (OnPostAllTransfers) or the user closes
 * the dialog (OnSourceUIClose).
 */
function acquire(twain: WebTwain): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: string) => {
      twain.UnregisterEvent('OnPostAllTransfers', done)
      twain.UnregisterEvent('OnSourceUIClose', done)
      if (error) reject(new Error(error))
      else resolve()
    }
    const done = () => finish()
    twain.RegisterEvent('OnPostAllTransfers', done)
    twain.RegisterEvent('OnSourceUIClose', done)
    twain.AcquireImage(
      { IfShowUI: true, IfDisableSourceAfterAcquire: true },
      () => {
        if (twain.HowManyImagesInBuffer > 0) done()
      },
      (_config, _code, error) => finish(error || 'The scan failed.'),
    )
  })
}

/**
 * Asks for the source scanner (Dynamsoft's source dialog), scans through the scanner's own dialog and
 * returns the scanned pages as one multi-page TIFF; null when the user cancels or nothing was scanned.
 */
export async function scanToTiff(): Promise<Blob | null> {
  const { dynamsoft, twain } = await connect()
  const sources = await twain.GetSourceNamesAsync(false)
  if (sources.length === 0) throw new Error('No scanners found. Check that the scanner is connected and its driver is installed.')
  try {
    // Resolves with the chosen source's index (despite the typings); Cancel rejects with "User cancelled".
    await twain.SelectSourceAsync()
  } catch (err) {
    if (isCancel(err)) return null
    throw new Error(message(err))
  }
  twain.RemoveAllImages()
  try {
    await twain.OpenSourceAsync()
    await acquire(twain)
  } catch (err) {
    if (twain.HowManyImagesInBuffer === 0) {
      if (isCancel(err)) return null
      throw new Error(message(err))
    }
  } finally {
    twain.CloseSource()
  }
  const count = twain.HowManyImagesInBuffer
  if (count === 0) return null
  try {
    return await new Promise<Blob>((resolve, reject) =>
      twain.ConvertToBlob(
        Array.from({ length: count }, (_, i) => i),
        dynamsoft.DWT.EnumDWT_ImageType.IT_TIF,
        (blob) => resolve(blob),
        (_code, error) => reject(new Error(error)),
      ),
    )
  } finally {
    twain.RemoveAllImages()
  }
}
