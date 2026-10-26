/**
 * Keeps `sources.firstParty` honest.
 *
 * Every entry cites a documentation page, and the citation is the only
 * thing a future re-verification pass has to work from. Those pages move:
 * a sweep found 14 of 26 stale at once, two returning 404 outright (goose
 * had moved host entirely, OpenCode had moved path) and the rest
 * redirecting, including Windsurf's docs relocating under Devin after the
 * acquisition. A redirect is a warning that the page moved and the
 * citation is drifting behind it.
 *
 * Needs the network, so it is gated. A test that fails when a docs site
 * is briefly down must not gate a release.
 *
 *   CATALOG_URL_CHECK=1 bun test test/unit/catalog-sources.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { CATALOG } from '../../src/_catalog/client-configs.ts'

const ENABLED = Boolean(process.env.CATALOG_URL_CHECK)

/** HEAD-ish fetch that reports the status without following redirects. */
async function statusOf(url: string): Promise<number> {
  const response: unknown = await fetch(url, { redirect: 'manual' })
  if (
    typeof response !== 'object' ||
    response === null ||
    !('status' in response) ||
    typeof response.status !== 'number'
  ) {
    throw new Error(`no status for ${url}`)
  }
  return response.status
}

describe('catalog source citations', () => {
  test('every entry cites an http(s) documentation URL', () => {
    // Runs offline. The shape check is worth having on its own.
    for (const entry of CATALOG) {
      expect(entry.sources.firstParty).toMatch(/^https?:\/\//)
    }
  })

  test.skipIf(!ENABLED)(
    'no citation 404s or redirects',
    async () => {
      // Deduplicated: vscode/vscode-insiders and cline/cline-cli share a
      // page, and hitting it twice tells us nothing extra.
      const urls = [...new Set(CATALOG.map((e) => e.sources.firstParty))]
      const stale: string[] = []
      await Promise.all(
        urls.map(async (url) => {
          try {
            const status = await statusOf(url)
            if (status < 200 || status >= 300) stale.push(`${status} ${url}`)
          } catch (err) {
            stale.push(`ERR ${url}: ${(err as Error).message}`)
          }
        }),
      )
      expect(stale.sort()).toEqual([])
    },
    60_000,
  )
})
