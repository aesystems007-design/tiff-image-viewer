import type { MarginSpec } from './margins'

/**
 * Fetches the margin rules for a document. Stand-in until the real API is wired up: reads
 * `samples/margins.json` (served by the dev server only). Resolves to null when there are no rules.
 */
export async function loadMargins(_fileName: string): Promise<MarginSpec | null> {
  const response = await fetch('/samples/margins.json', { cache: 'no-store' })
  if (!response.ok) return null
  const spec = (await response.json()) as MarginSpec | null
  return spec?.firstPage && spec.lastPage && spec.defaultPage ? spec : null
}
