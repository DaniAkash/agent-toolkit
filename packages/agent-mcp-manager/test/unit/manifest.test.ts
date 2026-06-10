import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  emptyManifest,
  readManifest,
  writeManifest,
} from '../../src/_internal/manifest.ts'
import {
  makeTmpWorkspace,
  type TmpWorkspace,
} from '../helpers/tmp-workspace.ts'

let ws: TmpWorkspace

beforeEach(async () => {
  ws = await makeTmpWorkspace()
})

afterEach(async () => {
  await ws.cleanup()
})

describe('manifest', () => {
  test('emptyManifest is version 1 + empty servers', () => {
    expect(emptyManifest()).toEqual({ version: 1, servers: {} })
  })

  test('readManifest returns empty when file is missing', async () => {
    const m = await readManifest(ws.workspaceDir)
    expect(m).toEqual({ version: 1, servers: {} })
  })

  test('write + read round-trip preserves the manifest', async () => {
    const manifest = emptyManifest()
    manifest.servers.github = {
      name: 'github',
      spec: { transport: 'stdio', command: 'gh-mcp' },
      addedAt: '2026-06-10T18:00:00.000Z',
      links: {
        'claude-code': {
          configPath: '/tmp/.claude.json',
          createdAt: '2026-06-10T18:01:00.000Z',
        },
      },
    }
    await writeManifest(ws.workspaceDir, manifest)
    expect(await readManifest(ws.workspaceDir)).toEqual(manifest)
  })
})
