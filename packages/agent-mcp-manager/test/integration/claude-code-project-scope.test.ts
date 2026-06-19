import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  createMcpManager,
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

describe('claude-code project scope', () => {
  test('stdio link writes type: "stdio" into .mcp.json', async () => {
    const mgr = createMcpManager({
      workspaceDir: ws.workspaceDir,
      scope: 'project',
      projectRoot: ws.configsDir,
    })
    await mgr.add({
      name: 'gh-mcp',
      spec: { transport: 'stdio', command: 'gh-mcp' },
    })
    const res = await mgr.link({ serverName: 'gh-mcp', agent: 'claude-code' })
    expect(res.created).toBe(true)
    const raw = await readFile(join(ws.configsDir, '.mcp.json'), 'utf8')
    expect(JSON.parse(raw).mcpServers['gh-mcp']).toEqual({
      command: 'gh-mcp',
      type: 'stdio',
    })
  })

  test('http link to project scope throws UnsupportedTransportError', async () => {
    const mgr = createMcpManager({
      workspaceDir: ws.workspaceDir,
      scope: 'project',
      projectRoot: ws.configsDir,
    })
    await mgr.add({
      name: 'remote',
      spec: { transport: 'http', url: 'https://example.com/mcp' },
    })
    const err = await mgr
      .link({ serverName: 'remote', agent: 'claude-code' })
      .catch((e) => e)
    expect(err).toBeInstanceOf(UnsupportedTransportError)
    expect((err as UnsupportedTransportError).details.hint).toContain(
      'system scope',
    )
  })

  test('sse link to project scope throws UnsupportedTransportError', async () => {
    const mgr = createMcpManager({
      workspaceDir: ws.workspaceDir,
      scope: 'project',
      projectRoot: ws.configsDir,
    })
    await mgr.add({
      name: 'sse-svc',
      spec: { transport: 'sse', url: 'https://example.com/sse' },
    })
    await expect(
      mgr.link({ serverName: 'sse-svc', agent: 'claude-code' }),
    ).rejects.toBeInstanceOf(UnsupportedTransportError)
  })

  test('system scope still accepts http (loose ~/.claude.json shape)', async () => {
    const mgr = createMcpManager({
      workspaceDir: ws.workspaceDir,
      agentConfigPaths: {
        'claude-code': join(ws.configsDir, 'claude.json'),
      },
    })
    await mgr.add({
      name: 'remote',
      spec: { transport: 'http', url: 'https://example.com/mcp' },
    })
    const res = await mgr.link({ serverName: 'remote', agent: 'claude-code' })
    expect(res.created).toBe(true)
    const raw = await readFile(join(ws.configsDir, 'claude.json'), 'utf8')
    expect(JSON.parse(raw).mcpServers.remote).toEqual({
      url: 'https://example.com/mcp',
    })
    // System scope still writes no `type` tag (matches the historical
    // ~/.claude.json shape; only project scope injects type: "stdio").
    expect(JSON.parse(raw).mcpServers.remote.type).toBeUndefined()
  })

  test('system scope stdio link omits the type tag', async () => {
    const mgr = createMcpManager({
      workspaceDir: ws.workspaceDir,
      agentConfigPaths: {
        'claude-code': join(ws.configsDir, 'claude.json'),
      },
    })
    await mgr.add({
      name: 'gh-mcp',
      spec: { transport: 'stdio', command: 'gh-mcp' },
    })
    await mgr.link({ serverName: 'gh-mcp', agent: 'claude-code' })
    const raw = await readFile(join(ws.configsDir, 'claude.json'), 'utf8')
    expect(JSON.parse(raw).mcpServers['gh-mcp']).toEqual({ command: 'gh-mcp' })
  })
})
