import TOML from '@iarna/toml'

import type { TomlCodexEmitterConfig } from '../_vendor/catalog.ts'
import { InvalidServerSpecError } from '../errors.ts'
import type { McpServerSpec } from '../types.ts'

/**
 * Codex stores MCP servers in `~/.codex/config.toml` under the
 * `mcp_servers.{NAME}` table. Per the official Codex MCP docs at
 * https://developers.openai.com/codex/mcp, two transports are
 * accepted:
 *
 *   - stdio: `command` (required) + `args` (optional). `env` is not
 *     serialised here, matching docker-mcp's codex_handler.go.
 *   - streamable-HTTP: `url` (required) + `http_headers` (optional
 *     static header map). `bearer_token_env_var` and
 *     `env_http_headers` are accepted by codex but not exposed
 *     through `McpHttpSpec`; consumers that need env-sourced bearer
 *     tokens hand-edit for now (see issue #61 follow-up notes).
 *
 * SSE is not part of codex's TOML schema. `link()` gates on the
 * catalog's `supportedTransports` and rejects sse with
 * `UnsupportedTransportError` before reaching this emitter; the
 * emitter also throws `InvalidServerSpecError` to protect direct
 * callers (unit tests, custom orchestrators) that bypass `link()`.
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
  const doc = parseDoc(raw)
  const table = ensureMap(doc, config.tableKey)
  if (spec.transport === 'stdio') {
    const value: Record<string, unknown> = { command: spec.command }
    if (spec.args && spec.args.length > 0) value.args = spec.args
    table[name] = value
  } else if (spec.transport === 'http') {
    const value: Record<string, unknown> = { url: spec.url }
    if (spec.headers && Object.keys(spec.headers).length > 0) {
      value.http_headers = spec.headers
    }
    table[name] = value
  } else {
    throw new InvalidServerSpecError(
      `Codex does not support the "${spec.transport}" transport (accepts stdio and http only)`,
    )
  }
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
