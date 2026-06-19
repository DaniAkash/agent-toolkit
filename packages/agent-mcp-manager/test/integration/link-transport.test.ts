import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createMcpManager, UnsupportedTransportError } from '../../src/index.ts'
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

describe('link() transport-capability gate', () => {
  test('http spec to claude-desktop throws UnsupportedTransportError', async () => {
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
    const err = await mgr
      .link({ serverName: 'browseros', agent: 'claude-desktop' })
      .catch((e) => e)
    expect(err).toBeInstanceOf(UnsupportedTransportError)
    expect((err as UnsupportedTransportError).agent).toBe('claude-desktop')
    expect((err as UnsupportedTransportError).transport).toBe('http')
    expect((err as UnsupportedTransportError).details.hint).toContain(
      'mcp-remote',
    )
  })

  test('sse spec to claude-desktop throws UnsupportedTransportError', async () => {
    const mgr = createMcpManager({
      workspaceDir: ws.workspaceDir,
      agentConfigPaths: {
        'claude-desktop': configFor(ws, 'claude-desktop'),
      },
    })
    await mgr.add({
      name: 'sse-srv',
      spec: { transport: 'sse', url: 'https://example.com/sse' },
    })
    await expect(
      mgr.link({ serverName: 'sse-srv', agent: 'claude-desktop' }),
    ).rejects.toBeInstanceOf(UnsupportedTransportError)
  })

  test('http spec to codex throws UnsupportedTransportError', async () => {
    const mgr = createMcpManager({
      workspaceDir: ws.workspaceDir,
      agentConfigPaths: {
        codex: join(ws.configsDir, 'codex.toml'),
      },
    })
    await mgr.add({
      name: 'remote',
      spec: { transport: 'http', url: 'https://example.com' },
    })
    await expect(
      mgr.link({ serverName: 'remote', agent: 'codex' }),
    ).rejects.toBeInstanceOf(UnsupportedTransportError)
  })

  test('stdio spec to claude-desktop still succeeds', async () => {
    const mgr = createMcpManager({
      workspaceDir: ws.workspaceDir,
      agentConfigPaths: {
        'claude-desktop': configFor(ws, 'claude-desktop'),
      },
    })
    await mgr.add({
      name: 'gh-mcp',
      spec: { transport: 'stdio', command: 'gh-mcp' },
    })
    const res = await mgr.link({
      serverName: 'gh-mcp',
      agent: 'claude-desktop',
    })
    expect(res.created).toBe(true)
    const raw = await readFile(configFor(ws, 'claude-desktop'), 'utf8')
    expect(JSON.parse(raw).mcpServers['gh-mcp']).toEqual({ command: 'gh-mcp' })
  })

  test('http spec to cursor succeeds (full transport set)', async () => {
    const mgr = createMcpManager({
      workspaceDir: ws.workspaceDir,
      agentConfigPaths: { cursor: configFor(ws, 'cursor') },
    })
    await mgr.add({
      name: 'remote',
      spec: { transport: 'http', url: 'https://example.com' },
    })
    const res = await mgr.link({ serverName: 'remote', agent: 'cursor' })
    expect(res.created).toBe(true)
  })

  test('transport gate fires before file IO', async () => {
    const mgr = createMcpManager({
      workspaceDir: ws.workspaceDir,
      agentConfigPaths: {
        'claude-desktop': configFor(ws, 'claude-desktop'),
      },
    })
    await mgr.add({
      name: 'browseros',
      spec: { transport: 'http', url: 'https://example.com' },
    })
    await expect(
      mgr.link({ serverName: 'browseros', agent: 'claude-desktop' }),
    ).rejects.toBeInstanceOf(UnsupportedTransportError)
    // No config file was created because the gate threw before the
    // emitter ran.
    await expect(
      readFile(configFor(ws, 'claude-desktop'), 'utf8'),
    ).rejects.toThrow()
  })

  test('error hint message points at mcp-remote pattern with command syntax', () => {
    // Independent of agent; the hint must name mcp-remote so users can
    // resolve the error from the message alone.
    const err = new UnsupportedTransportError('claude-desktop', 'http', {
      supported: ['stdio'],
      hint: 'Claude Desktop only accepts stdio MCP servers. Wrap with `npx -y mcp-remote <url>`.',
    })
    expect(err.details.hint).toContain('mcp-remote')
    expect(err.details.hint).toContain('npx')
  })

  test('UnsupportedTransportError exposes supported set as an array', () => {
    const err = new UnsupportedTransportError('codex', 'sse', {
      supported: ['stdio'],
      hint: '',
    })
    expect(Array.isArray(err.details.supported)).toBe(true)
    expect(err.details.supported).toEqual(['stdio'])
  })
})
