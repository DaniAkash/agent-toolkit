/**
 * Announces vendored-catalog drift.
 *
 * `src/_vendor/` is a point-in-time copy of a subset of
 * vercel-labs/skills. Nothing in a copy can notice that it has aged, and
 * the 1.5.22 -> 1.7.4 gap proved the cost: 22 releases passed unnoticed,
 * one of which moved Codex's global skills directory and quietly broke
 * `link({ agent: 'codex' })`.
 *
 * This checks the pinned version against the latest published one and
 * fails when the gap gets wide enough to be worth a look. It compares
 * versions, not bytes, deliberately: the vendored files carry documented
 * local edits (explicit types for the DTS build, import-path changes,
 * formatting) that a byte comparison would have to normalise away, and
 * getting that normalisation wrong produces a test that is either
 * permanently red or silently vacuous. A version gap needs no
 * normalisation and would have caught this exact case 22 releases ago.
 *
 * Gated behind SKILLS_DRIFT_CHECK because it needs the network. A test
 * that fails when the registry is unreachable is worse than no test, and
 * this must not gate a release.
 *
 *   SKILLS_DRIFT_CHECK=1 bun test test/unit/vendor-drift.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

/**
 * The upstream version `src/_vendor/` was copied from. Bump this and the
 * file headers together on every refresh.
 */
const VENDORED_VERSION = '1.7.4'

/**
 * How many minor releases behind is tolerable before the suite complains.
 * Upstream ships patch releases most weeks, so patch drift is noise; a
 * minor bump is where agent catalog entries have actually moved.
 *
 * Calibrated against the case that motivated this guard rather than
 * guessed: the 1.5.22 pin sat two minors behind 1.7.x, so a threshold of
 * 2 would have tolerated exactly the drift that broke Codex linking. One
 * flags it at 1.6.0, before the breaking change landed in 1.7.2.
 */
const MAX_MINOR_DRIFT = 1

const ENABLED = Boolean(process.env.SKILLS_DRIFT_CHECK)

function parseVersion(v: string): [number, number, number] {
  const parts = v.split('.').map((n) => Number.parseInt(n, 10))
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
}

describe('vendored skills catalog', () => {
  test('THIRD_PARTY_NOTICES records the same version this test pins', async () => {
    // Runs offline. Catches the half-done refresh where the notices file
    // and the drift pin disagree about what is actually vendored.
    const notices = await readFile(
      new URL('../../THIRD_PARTY_NOTICES.md', import.meta.url),
      'utf8',
    )
    expect(notices).toContain(`- Version: ${VENDORED_VERSION}`)
  })

  test('vendored file headers agree with the pinned version', async () => {
    // Also offline. The headers are what a reader checks first, so a stale
    // one is actively misleading.
    for (const file of ['agents.ts', 'types.ts', 'frontmatter.ts']) {
      const src = await readFile(
        new URL(`../../src/_vendor/${file}`, import.meta.url),
        'utf8',
      )
      expect(src).toContain(`skills@${VENDORED_VERSION}`)
    }
  })

  test.skipIf(!ENABLED)(
    'the pinned version is not far behind npm latest',
    async () => {
      const res = await fetch('https://registry.npmjs.org/skills/latest')
      expect(res.ok).toBe(true)
      const { version } = (await res.json()) as { version: string }

      const [pinnedMajor, pinnedMinor] = parseVersion(VENDORED_VERSION)
      const [latestMajor, latestMinor] = parseVersion(version)

      // A major bump always wants a look, whatever the minor distance.
      expect(latestMajor).toBe(pinnedMajor)
      expect(latestMinor - pinnedMinor).toBeLessThanOrEqual(MAX_MINOR_DRIFT)
    },
  )
})
