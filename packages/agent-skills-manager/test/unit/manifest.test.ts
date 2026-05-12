import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  emptyManifest,
  loadManifest,
  MANIFEST_FILE,
  MANIFEST_TMP_PREFIX,
  saveManifest,
} from '../../src/_internal/manifest.ts'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'skills-mgr-manifest-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('manifest', () => {
  test('emptyManifest returns version 1 + empty skills', () => {
    expect(emptyManifest()).toEqual({ version: 1, skills: {} })
  })

  test('loadManifest returns null when file is missing', async () => {
    expect(await loadManifest(dir)).toBeNull()
  })

  test('saveManifest + loadManifest round-trip preserves data', async () => {
    const manifest = emptyManifest()
    manifest.skills['my-skill'] = {
      name: 'my-skill',
      description: 'test',
      source: { kind: 'local', path: '/tmp/foo' },
      addedAt: '2026-05-11T00:00:00.000Z',
      links: {
        'claude-code': {
          linkPath: '/home/me/.claude/skills/my-skill',
          workspacePath: '/tmp/foo',
          createdAt: '2026-05-11T00:00:00.000Z',
        },
      },
    }
    await saveManifest(dir, manifest)
    const loaded = await loadManifest(dir)
    expect(loaded).toEqual(manifest)
  })

  test('saveManifest writes to .manifest.json and cleans up temp files', async () => {
    await saveManifest(dir, emptyManifest())
    const files = await readdir(dir)
    expect(files).toContain(MANIFEST_FILE)
    // Tmp files are renamed atop the real file; none should remain.
    expect(files.some((f) => f.startsWith(MANIFEST_TMP_PREFIX))).toBe(false)
  })

  test('loadManifest throws on unknown version', async () => {
    await Bun.write(
      join(dir, MANIFEST_FILE),
      JSON.stringify({ version: 999, skills: {} }),
    )
    await expect(loadManifest(dir)).rejects.toThrow(
      /Unsupported manifest version/,
    )
  })

  test('saveManifest produces JSON readable by another tool', async () => {
    const manifest = emptyManifest()
    manifest.skills.a = {
      name: 'a',
      description: 'd',
      source: { kind: 'github', ownerRepo: 'a/b' },
      addedAt: '2026-05-11T00:00:00.000Z',
      links: {},
    }
    await saveManifest(dir, manifest)
    const raw = await readFile(join(dir, MANIFEST_FILE), 'utf8')
    const parsed = JSON.parse(raw)
    expect(parsed.skills.a.source).toEqual({ kind: 'github', ownerRepo: 'a/b' })
  })
})
