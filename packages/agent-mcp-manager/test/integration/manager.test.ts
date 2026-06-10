import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  createMcpManager,
  ForeignEntryError,
  ServerNotFoundError,
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

describe('createMcpManager — happy path', () => {
  test('add → link → listLinks → unlink → empty', async () => {
    const mgr = createMcpManager({
      workspaceDir: ws.workspaceDir,
      agentConfigPaths: {
        'claude-code': configFor(ws, 'claude-code'),
        cursor: configFor(ws, 'cursor'),
      },
    })

    const add = await mgr.add({
      name: 'github',
      spec: { transport: 'stdio', command: 'gh-mcp' },
    })
    expect(add.created).toBe(true)

    const link1 = await mgr.link({ serverName: 'github', agent: 'claude-code' })
    expect(link1.created).toBe(true)
    const link2 = await mgr.link({ serverName: 'github', agent: 'cursor' })
    expect(link2.created).toBe(true)

    const links = await mgr.listLinks()
    expect(links).toHaveLength(2)
    const agents = links.map((l) => l.agent).sort()
    expect(agents).toEqual(['claude-code', 'cursor'])

    const raw = await readFile(configFor(ws, 'claude-code'), 'utf8')
    expect(JSON.parse(raw).mcpServers.github).toEqual({ command: 'gh-mcp' })

    const ul = await mgr.unlink({ serverName: 'github', agent: 'claude-code' })
    expect(ul.removed).toBe(true)
    const afterUnlink = await mgr.listLinks()
    expect(afterUnlink.map((l) => l.agent)).toEqual(['cursor'])
  })

  test('link is idempotent on rerun', async () => {
    const mgr = createMcpManager({
      workspaceDir: ws.workspaceDir,
      agentConfigPaths: { cursor: configFor(ws, 'cursor') },
    })
    await mgr.add({ name: 'svc', spec: { transport: 'stdio', command: 'x' } })
    const first = await mgr.link({ serverName: 'svc', agent: 'cursor' })
    expect(first.created).toBe(true)
    const second = await mgr.link({ serverName: 'svc', agent: 'cursor' })
    expect(second.created).toBe(false)
  })

  test('link before add raises ServerNotFoundError', async () => {
    const mgr = createMcpManager({
      workspaceDir: ws.workspaceDir,
      agentConfigPaths: { cursor: configFor(ws, 'cursor') },
    })
    await expect(
      mgr.link({ serverName: 'nope', agent: 'cursor' }),
    ).rejects.toBeInstanceOf(ServerNotFoundError)
  })

  test('unlink on an entry we never wrote raises ForeignEntryError', async () => {
    const cursor = configFor(ws, 'cursor')
    await Bun.write(
      cursor,
      JSON.stringify({ mcpServers: { foreign: { command: 'x' } } }),
    )
    const mgr = createMcpManager({
      workspaceDir: ws.workspaceDir,
      agentConfigPaths: { cursor },
    })
    await mgr.add({
      name: 'foreign',
      spec: { transport: 'stdio', command: 'unused' },
    })
    await expect(
      mgr.unlink({ serverName: 'foreign', agent: 'cursor' }),
    ).rejects.toBeInstanceOf(ForeignEntryError)
  })

  test('remove unlinks from every agent then drops the server', async () => {
    const mgr = createMcpManager({
      workspaceDir: ws.workspaceDir,
      agentConfigPaths: {
        cursor: configFor(ws, 'cursor'),
        'claude-code': configFor(ws, 'claude-code'),
      },
    })
    await mgr.add({ name: 'svc', spec: { transport: 'stdio', command: 'x' } })
    await mgr.link({ serverName: 'svc', agent: 'cursor' })
    await mgr.link({ serverName: 'svc', agent: 'claude-code' })

    await mgr.remove({ serverName: 'svc' })

    expect(await mgr.listServers()).toEqual([])
    const raw = await readFile(configFor(ws, 'cursor'), 'utf8')
    expect(JSON.parse(raw).mcpServers).toEqual({})
  })

  test('listLinks({ scanUnmanaged }) surfaces on-disk entries we did not write', async () => {
    const cursor = configFor(ws, 'cursor')
    await Bun.write(
      cursor,
      JSON.stringify({
        mcpServers: { tracked: { command: 't' }, untracked: { command: 'u' } },
      }),
    )
    const mgr = createMcpManager({
      workspaceDir: ws.workspaceDir,
      agentConfigPaths: { cursor },
    })
    await mgr.add({
      name: 'tracked',
      spec: { transport: 'stdio', command: 't' },
    })
    // Pretend we linked it (manifest has a recorded link for cursor)
    await mgr.link({ serverName: 'tracked', agent: 'cursor' })

    const links = await mgr.listLinks({
      scanUnmanaged: true,
      agents: ['cursor'],
    })
    const unmanaged = links.filter((l) => l.unmanaged)
    expect(unmanaged.map((l) => l.serverName)).toEqual(['untracked'])
  })
})
