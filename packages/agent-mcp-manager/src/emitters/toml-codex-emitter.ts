import TOML from '@iarna/toml'

import type { TomlCodexEmitterConfig } from '../_vendor/catalog.ts'
import { InvalidServerSpecError } from '../errors.ts'
import type { McpServerSpec } from '../types.ts'

/**
 * Codex stores MCP servers in `~/.codex/config.toml` under the
 * `mcp_servers.{NAME}` table. Per docker-mcp/pkg/client/codex_handler.go,
 * the only fields written are `command` and `args` — env is not
 * serialised. Codex's MCP support is stdio-only in upstream today.
 */

function parseDoc(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  return TOML.parse(raw) as Record<string, unknown>
}

function ensureMap(
  doc: Record<string, unknown>,
  tableKey: string,
): Record<string, unknown> {
  let table = doc[tableKey]
  if (!table || typeof table !== 'object') {
    table = {}
    doc[tableKey] = table
  }
  return table as Record<string, unknown>
}

export function tomlCodexRead(
  raw: string,
  config: TomlCodexEmitterConfig,
): string[] {
  const doc = parseDoc(raw)
  const table = doc[config.tableKey]
  if (!table || typeof table !== 'object') return []
  return Object.keys(table as Record<string, unknown>)
}

export function tomlCodexAdd(
  raw: string,
  name: string,
  spec: McpServerSpec,
  config: TomlCodexEmitterConfig,
): string {
  if (spec.transport !== 'stdio') {
    throw new InvalidServerSpecError(
      `Codex only supports stdio MCP servers; received transport "${spec.transport}"`,
    )
  }
  const doc = parseDoc(raw)
  const table = ensureMap(doc, config.tableKey)
  const value: Record<string, unknown> = { command: spec.command }
  if (spec.args && spec.args.length > 0) value.args = spec.args
  table[name] = value
  return TOML.stringify(doc as TOML.JsonMap)
}

export function tomlCodexRemove(
  raw: string,
  name: string,
  config: TomlCodexEmitterConfig,
): string {
  if (!raw.trim()) return raw
  const doc = parseDoc(raw)
  const table = doc[config.tableKey]
  if (table && typeof table === 'object') {
    const t = table as Record<string, unknown>
    if (name in t) delete t[name]
    if (Object.keys(t).length === 0) delete doc[config.tableKey]
  }
  return TOML.stringify(doc as TOML.JsonMap)
}
