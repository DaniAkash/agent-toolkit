import { parse as parseToml } from 'smol-toml'

import type { McpServerSpec } from '../types.ts'
import { buildEntryValue, type ResolvedShapes, transformKey } from './shape.ts'

/**
 * TOML config emitter. Codex is the only TOML consumer in the catalog.
 *
 * Edits are surgical: exactly one byte span of the file changes and
 * everything else is left untouched. Codex's `config.toml` is a file the
 * user owns and hand-edits, holding their model choice, approval policy,
 * sandbox permissions and feature flags, and a parse-then-serialise round
 * trip drops every comment and blank line in it along with the original
 * key ordering.
 *
 * The parser is used to decide *whether* a table exists and to list the
 * entries; a lexical scan finds *where* it lives. Serialisation is local
 * to the one table being written.
 */

/** Byte span of one `[prefix.name]` table, header line included. */
interface TableSpan {
  name: string
  /** Index of the first character of the header line. */
  start: number
  /** Index one past the table's last character (start of the next header, or EOF). */
  end: number
}

/**
 * Find the `[prefix.<name>]` tables in `raw`, with their spans.
 *
 * A lexical scan rather than a parse, because the parse result carries no
 * positions. It tracks multi-line string state so a `[not.a.header]` line
 * inside a `"""` or `'''` literal is not mistaken for a table header,
 * which is the one way a naive line scan corrupts a real config.
 */
function scanTables(raw: string, prefix: string): TableSpan[] {
  const spans: TableSpan[] = []
  let offset = 0
  let inMultiline: '"""' | "'''" | null = null
  let current: { name: string; start: number } | null = null
  /**
   * Start of the run of comment and blank lines immediately before the
   * line being read, or null when the previous line was content.
   *
   * A comment sitting directly above a header documents that header, so it
   * has to end the previous table's span rather than belong to it.
   * Otherwise removing one server eats the comment introducing the next.
   */
  let runStart: number | null = null

  const closeCurrent = (end: number): void => {
    if (current) {
      spans.push({ name: current.name, start: current.start, end })
      current = null
    }
  }

  for (const line of raw.split('\n')) {
    const lineStart = offset
    offset += line.length + 1

    if (inMultiline) {
      if (line.includes(inMultiline)) inMultiline = null
      continue
    }

    const trimmed = line.trim()

    // Opening a multi-line string: count the delimiters on this line, and
    // stay inside only when it is left open.
    for (const delim of ['"""', "'''"] as const) {
      const occurrences = line.split(delim).length - 1
      if (occurrences % 2 === 1) {
        inMultiline = delim
        break
      }
    }
    if (inMultiline) continue

    const isHeader =
      trimmed.startsWith('[') &&
      trimmed.endsWith(']') &&
      !trimmed.startsWith('[[')
    const isArrayHeader = trimmed.startsWith('[[')

    if (!isHeader && !isArrayHeader) {
      if (trimmed.length === 0 || trimmed.startsWith('#')) {
        if (runStart === null) runStart = lineStart
      } else {
        runStart = null
      }
      continue
    }

    // Any header at any level ends the table that was in progress, at the
    // start of the comment block introducing it rather than at its own line.
    closeCurrent(runStart ?? lineStart)
    runStart = null
    if (!isHeader) continue

    const path = parseHeaderPath(trimmed.slice(1, -1))
    if (path.length === 2 && path[0] === prefix) {
      current = { name: path[1] as string, start: lineStart }
    }
  }
  closeCurrent(raw.length)
  return spans
}

/** Split a dotted TOML key path, honouring quoted segments. */
function parseHeaderPath(header: string): string[] {
  const parts: string[] = []
  let buf = ''
  let quote: '"' | "'" | null = null
  for (const ch of header) {
    if (quote) {
      if (ch === quote) quote = null
      else buf += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '.') {
      parts.push(buf.trim())
      buf = ''
      continue
    }
    buf += ch
  }
  parts.push(buf.trim())
  return parts.filter((p) => p.length > 0)
}

function parseDoc(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  return parseToml(raw) as Record<string, unknown>
}

/** Serialise one scalar / array / inline-table value as TOML. */
function renderValue(value: unknown): string {
  if (typeof value === 'string') return renderString(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    return `[${value.map(renderValue).join(', ')}]`
  }
  if (value && typeof value === 'object') {
    const pairs = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${renderKey(k)} = ${renderValue(v)}`)
    return `{ ${pairs.join(', ')} }`
  }
  // `null` has no TOML spelling; the entry builder never emits one.
  return '""'
}

function renderString(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
  return `"${escaped}"`
}

const BARE_KEY = /^[A-Za-z0-9_-]+$/

function renderKey(key: string): string {
  return BARE_KEY.test(key) ? key : renderString(key)
}

/** Render a whole `[prefix.name]` table, trailing newline included. */
function renderTable(
  prefix: string,
  name: string,
  entry: Record<string, unknown>,
): string {
  const lines = [`[${renderKey(prefix)}.${renderKey(name)}]`]
  for (const [key, value] of Object.entries(entry)) {
    if (value === undefined) continue
    lines.push(`${renderKey(key)} = ${renderValue(value)}`)
  }
  return `${lines.join('\n')}\n`
}

export function tomlRead(raw: string, shapes: ResolvedShapes): string[] {
  const doc = parseDoc(raw)
  const table = doc[shapes.topLevelKey]
  if (!table || typeof table !== 'object') return []
  return Object.keys(table as Record<string, unknown>)
}

export function tomlAdd(
  raw: string,
  name: string,
  spec: McpServerSpec,
  shapes: ResolvedShapes,
): string {
  const prefix = shapes.topLevelKey
  const key = transformKey(name, shapes.stdio)
  const entry = buildEntryValue(spec, shapes)
  const rendered = renderTable(prefix, key, entry)

  // Parse first: an unparseable file must fail here rather than be
  // appended to and corrupted further.
  const doc = parseDoc(raw)
  const existingTable = doc[prefix]
  const entryExists =
    existingTable !== null &&
    typeof existingTable === 'object' &&
    key in (existingTable as Record<string, unknown>)

  const span = scanTables(raw, prefix).find((s) => s.name === key)

  if (span) {
    return raw.slice(0, span.start) + rendered + raw.slice(span.end)
  }

  if (entryExists) {
    // The entry exists but not as its own `[prefix.name]` table, so it was
    // written inline (`mcp_servers = { foo = { ... } }`). There is no span
    // to swap, and appending a table would duplicate the key. Rewriting
    // the document is the only correct answer here, and it is the one case
    // that still loses comments. Codex does not write this shape itself.
    return rewriteWhole(doc, prefix, key, entry)
  }

  const separator = raw.length === 0 || raw.endsWith('\n\n') ? '' : '\n'
  const prelude = raw.length === 0 ? '' : raw.endsWith('\n') ? '' : '\n'
  return `${raw}${prelude}${separator}${rendered}`
}

export function tomlRemove(
  raw: string,
  name: string,
  shapes: ResolvedShapes,
): string {
  if (!raw.trim()) return raw
  const prefix = shapes.topLevelKey
  const key = transformKey(name, shapes.stdio)

  const doc = parseDoc(raw)
  const span = scanTables(raw, prefix).find((s) => s.name === key)
  if (!span) {
    const existingTable = doc[prefix]
    const entryExists =
      existingTable !== null &&
      typeof existingTable === 'object' &&
      key in (existingTable as Record<string, unknown>)
    // Same inline-table caveat as tomlAdd.
    if (entryExists) return rewriteWhole(doc, prefix, key, undefined)
    return raw
  }

  const before = raw.slice(0, span.start)
  const after = raw.slice(span.end)
  // Cutting a table leaves the blank line that separated it from the
  // previous one, which would accumulate over repeated add/remove cycles.
  return `${before.replace(/\n{2,}$/, '\n')}${after}`
}

/**
 * Last-resort full rewrite, for a config whose entries are inline tables
 * rather than `[prefix.name]` headers. Loses comments, which is why every
 * other path avoids it.
 */
function rewriteWhole(
  doc: Record<string, unknown>,
  prefix: string,
  key: string,
  entry: Record<string, unknown> | undefined,
): string {
  const table = { ...((doc[prefix] ?? {}) as Record<string, unknown>) }
  if (entry === undefined) delete table[key]
  else table[key] = entry

  const next: Record<string, unknown> = { ...doc }
  if (Object.keys(table).length === 0) delete next[prefix]
  else next[prefix] = table

  const scalars: string[] = []
  const tables: string[] = []
  for (const [k, v] of Object.entries(next)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const nested = v as Record<string, unknown>
      const allTables = Object.values(nested).every(
        (x) => x !== null && typeof x === 'object' && !Array.isArray(x),
      )
      if (allTables && Object.keys(nested).length > 0) {
        for (const [subKey, subValue] of Object.entries(nested)) {
          tables.push(
            renderTable(k, subKey, subValue as Record<string, unknown>),
          )
        }
        continue
      }
      tables.push(
        `[${renderKey(k)}]\n${Object.entries(nested)
          .map(([nk, nv]) => `${renderKey(nk)} = ${renderValue(nv)}`)
          .join('\n')}\n`,
      )
      continue
    }
    scalars.push(`${renderKey(k)} = ${renderValue(v)}`)
  }
  const head = scalars.length > 0 ? `${scalars.join('\n')}\n` : ''
  const body = tables.join('\n')
  return head && body ? `${head}\n${body}` : head || body
}
