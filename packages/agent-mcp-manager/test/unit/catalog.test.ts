import { describe, expect, test } from 'bun:test'

import { CATALOG, CATALOG_BY_ID } from '../../src/_catalog/client-configs.ts'
import { validateCatalog } from '../../src/_catalog/validate.ts'

const NOW = new Date('2026-07-06T00:00:00Z')

describe('populated catalog', () => {
  test('every entry passes the validator against a recent NOW', () => {
    const errors = validateCatalog(CATALOG, NOW)
    expect(errors).toEqual([])
  })

  test('ships 26 clients matching Smithery roster + docker-known set + CLIs', () => {
    expect(CATALOG).toHaveLength(26)
    expect(CATALOG.map((e) => e.id).sort()).toEqual([
      'amazon-bedrock',
      'amazonq',
      'antigravity',
      'boltai',
      'claude-code',
      'claude-desktop',
      'cline',
      'cline-cli',
      'codex',
      'copilot-cli',
      'cursor',
      'devin-cli',
      'enconvo',
      'gemini',
      'goose',
      'kiro',
      'librechat',
      'opencode',
      'roocode',
      'tome',
      'trae',
      'vscode',
      'vscode-insiders',
      'windsurf',
      'witsy',
      'zed',
    ])
  })

  test('CATALOG_BY_ID lookup returns the right entry per id', () => {
    for (const entry of CATALOG) {
      expect(CATALOG_BY_ID[entry.id]).toBe(entry)
    }
  })

  test('clients using serverUrl URL rename are captured (windsurf, antigravity)', () => {
    expect(CATALOG_BY_ID.windsurf.http?.urlField).toBe('serverUrl')
    expect(CATALOG_BY_ID.antigravity.http?.urlField).toBe('serverUrl')
  })

  test('clients using non-default HTTP tag values are captured', () => {
    expect(CATALOG_BY_ID.cline.http?.tagValue).toBe('streamableHttp')
    expect(CATALOG_BY_ID.kiro.http?.tagValue).toBe('streamable-http')
    expect(CATALOG_BY_ID.opencode.http?.tagValue).toBe('remote')
  })

  test('goose keeps its stdio quirks: cmd/envs renames, simpleName transform, type: stdio tag', () => {
    const g = CATALOG_BY_ID.goose.stdio
    expect(g.commandField).toBe('cmd')
    expect(g.envField).toBe('envs')
    expect(g.keyTransform).toBe('simpleName')
    expect(g.tagKey).toBe('type')
    expect(g.tagValue).toBe('stdio')
  })

  test('opencode: commandAsArray, env rename, type: local stdio inject', () => {
    const o = CATALOG_BY_ID.opencode.stdio
    expect(o.commandAsArray).toBe(true)
    expect(o.envField).toBe('environment')
    expect(o.injects).toEqual({ type: 'local', enabled: true })
  })

  test('claude-desktop is stdio-only (guards against the v0.0.2 regression)', () => {
    const cd = CATALOG_BY_ID['claude-desktop']
    expect(cd.supportedTransports.system).toEqual(['stdio'])
    expect(cd.http).toBeUndefined()
  })

  test('claude-code project scope forces stdio-only with a type tag', () => {
    const cc = CATALOG_BY_ID['claude-code']
    expect(cc.projectFile).toBe('.mcp.json')
    expect(cc.supportedTransports.project).toEqual(['stdio'])
    expect(cc.project?.stdio.tagKey).toBe('type')
    expect(cc.project?.stdio.tagValue).toBe('stdio')
  })

  test('claude-code system HTTP shape writes type: "http" and type: "sse" per transport', () => {
    // Regression: Claude Code emits a parse warning for HTTP entries
    // that lack an explicit `type` field. Without this shape, the
    // library wrote entries Claude Code silently rejected on launch.
    const cc = CATALOG_BY_ID['claude-code']
    expect(cc.http?.tagKey).toBe('type')
    expect(cc.http?.tagValue).toBe('http')
    expect(cc.http?.sseTagValue).toBe('sse')
  })
})

describe('verification provenance', () => {
  test('every entry verified against a known client release records it', () => {
    // `verified` is a date and cannot say which client major it describes.
    // Entries checked first-hand carry the release too; the rest leave the
    // field unset rather than claim a version nobody looked at.
    const withVersion = CATALOG.filter((e) => e.sources.verifiedAgainst)
    expect(withVersion.length).toBeGreaterThanOrEqual(13)
    for (const entry of withVersion) {
      // Shaped `<client>@<version>`, so the value is greppable.
      expect(entry.sources.verifiedAgainst).toContain('@')
      // A recorded version implies the entry was looked at that day.
      expect(entry.sources.verified).toBe('2026-10-26')
    }
  })

  test('an entry without a recorded version still has a date', () => {
    for (const entry of CATALOG) {
      expect(entry.sources.verified).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})
