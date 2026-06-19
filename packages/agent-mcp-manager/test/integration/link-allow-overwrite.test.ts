import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  createMcpManager,
  ForeignEntryError,
  UnsupportedTransportError,
} from '../../src/index.ts'
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

function configFor(ws: TmpWorkspace, agent: string): string {
  return join(ws.configsDir, `${agent}.json`)
}

describe('link({ allowOverwrite })', () => {
  test('default false: foreign on-disk entry throws ForeignEntryError', async () => {
    const cfg = configFor(ws, 'claude-code')
    await writeFile(
      cfg,
      JSON.stringify(
        { mcpServers: { BrowserOS: { command: 'pre-existing' } } },
        null,
        2,
      ),
    )
    const mgr = createMcpManager({
      workspaceDir: ws.workspaceDir,
      agentConfigPaths: { 'claude-code': cfg },
    })
    await mgr.add({
      name: 'BrowserOS',
      spec: { transport: 'stdio', command: 'browseros-mcp' },
    })
    await expect(
      mgr.link({ serverName: 'BrowserOS', agent: 'claude-code' }),
    ).rejects.toBeInstanceOf(ForeignEntryError)
  })

  test('allowOverwrite: true adopts the foreign entry', async () => {
    const cfg = configFor(ws, 'claude-code')
    await writeFile(
      cfg,
      JSON.stringify(
        { mcpServers: { BrowserOS: { command: 'pre-existing' } } },
        null,
        2,
      ),
    )
    const mgr = createMcpManager({
      workspaceDir: ws.workspaceDir,
      agentConfigPaths: { 'claude-code': cfg },
    })
    await mgr.add({
      name: 'BrowserOS',
      spec: { transport: 'stdio', command: 'browseros-mcp' },
    })
    const res = await mgr.link({
      serverName: 'BrowserOS',
      agent: 'claude-code',
      allowOverwrite: true,
    })
    expect(res.created).toBe(true)
    const after = JSON.parse(await readFile(cfg, 'utf8'))
    expect(after.mcpServers.BrowserOS).toEqual({ command: 'browseros-mcp' })

    // Manifest now records the link; subsequent unlink works without
    // tripping ForeignEntryError.
    const links = await mgr.listLinks()
    expect(links.map((l) => l.agent)).toContain('claude-code')

    const unlink = await mgr.unlink({
      serverName: 'BrowserOS',
      agent: 'claude-code',
    })
    expect(unlink.removed).toBe(true)
  })

  test('allowOverwrite: true on a clean config is equivalent to default', async () => {
    const mgr = createMcpManager({
      workspaceDir: ws.workspaceDir,
      agentConfigPaths: { 'claude-code': configFor(ws, 'claude-code') },
    })
    await mgr.add({
      name: 'svc',
      spec: { transport: 'stdio', command: 'svc' },
    })
    const res = await mgr.link({
      serverName: 'svc',
      agent: 'claude-code',
      allowOverwrite: true,
    })
    expect(res.created).toBe(true)
  })

  test('allowOverwrite: true is idempotent on a manifest-owned entry', async () => {
    const cfg = configFor(ws, 'claude-code')
    const mgr = createMcpManager({
      workspaceDir: ws.workspaceDir,
      agentConfigPaths: { 'claude-code': cfg },
    })
    await mgr.add({
      name: 'svc',
      spec: { transport: 'stdio', command: 'svc' },
    })
    await mgr.link({ serverName: 'svc', agent: 'claude-code' })
    const before = await readFile(cfg, 'utf8')
    const res = await mgr.link({
      serverName: 'svc',
      agent: 'claude-code',
      allowOverwrite: true,
    })
    expect(res.created).toBe(false)
    const after = await readFile(cfg, 'utf8')
    expect(after).toBe(before)
  })

  test('allowOverwrite does NOT bypass the transport check', async () => {
    const mgr = createMcpManager({
      workspaceDir: ws.workspaceDir,
      agentConfigPaths: {
        'claude-desktop': configFor(ws, 'claude-desktop'),
      },
    })
    await mgr.add({
      name: 'browseros',
      spec: { transport: 'http', url: 'https://example.com/mcp' },
    })
    // Pre-seed an entry so the foreign-entry guard would fire if we
    // ever got past the transport check. allowOverwrite must NOT save
    // us from the transport error.
    await writeFile(
      configFor(ws, 'claude-desktop'),
      JSON.stringify(
        { mcpServers: { browseros: { command: 'old-stdio' } } },
        null,
        2,
      ),
    )
    await expect(
      mgr.link({
        serverName: 'browseros',
        agent: 'claude-desktop',
        allowOverwrite: true,
      }),
    ).rejects.toBeInstanceOf(UnsupportedTransportError)
  })

  test('allowOverwrite preserves siblings (only rewrites the named entry)', async () => {
    const cfg = configFor(ws, 'claude-code')
    await writeFile(
      cfg,
      JSON.stringify(
        {
          mcpServers: {
            sibling: { command: 'untouched' },
            BrowserOS: { command: 'pre-existing' },
          },
        },
        null,
        2,
      ),
    )
    const mgr = createMcpManager({
      workspaceDir: ws.workspaceDir,
      agentConfigPaths: { 'claude-code': cfg },
    })
    await mgr.add({
      name: 'BrowserOS',
      spec: { transport: 'stdio', command: 'browseros-mcp' },
    })
    await mgr.link({
      serverName: 'BrowserOS',
      agent: 'claude-code',
      allowOverwrite: true,
    })
    const after = JSON.parse(await readFile(cfg, 'utf8'))
    expect(after.mcpServers.sibling).toEqual({ command: 'untouched' })
    expect(after.mcpServers.BrowserOS).toEqual({ command: 'browseros-mcp' })
  })
})
