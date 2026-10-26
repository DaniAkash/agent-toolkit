import { parse as parseToml } from 'smol-toml'

import type { McpServerSpec } from '../types.ts'
import { buildEntryValue, type ResolvedShapes, transformKey } from './shape.ts'
import { renderTable, rewriteWhole } from './toml-render.ts'

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

const MULTILINE_DELIMS = ['"""', "'''"] as const
type MultilineDelim = (typeof MULTILINE_DELIMS)[number]

/** The multi-line string delimiter a line leaves open, if any. */
function opensMultiline(line: string): MultilineDelim | null {
  for (const delim of MULTILINE_DELIMS) {
    if ((line.split(delim).length - 1) % 2 === 1) return delim
  }
  return null
}

type LineKind = 'header' | 'arrayHeader' | 'filler' | 'content'

/**
 * Drop a trailing `#` comment, ignoring one inside a quoted key.
 *
 * A header may carry a comment: `[mcp_servers.ctx] # managed by me`. Without
 * stripping it the line does not end in `]`, so it reads as content, the
 * table gets no span, and the edit falls through to the whole-document
 * rewrite that loses every comment in the file. Quoted keys can contain a
 * literal `#`, so the scan has to respect quotes.
 */
function stripComment(line: string): string {
  let quote: '"' | "'" | null = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === quote) quote = null
      else if (ch === '\\' && quote === '"') i++
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '#') return line.slice(0, i)
  }
  return line
}

function classifyLine(trimmed: string): LineKind {
  if (trimmed.length === 0 || trimmed.startsWith('#')) return 'filler'
  const bare = stripComment(trimmed).trim()
  if (bare.startsWith('[[')) return 'arrayHeader'
  if (bare.startsWith('[') && bare.endsWith(']')) return 'header'
  return 'content'
}

interface LineToken {
  kind: LineKind
  trimmed: string
  start: number
}

/**
 * Tokenise the lines that are not inside a multi-line string.
 *
 * Separated from span assignment so neither half has to reason about the
 * other. Skipping multi-line strings is the part that matters: a
 * `[mcp_servers.fake]` line inside a `"""` block is not a header, and
 * treating it as one is how a naive line scan corrupts a real config.
 */
function tokenizeLines(raw: string): LineToken[] {
  const tokens: LineToken[] = []
  let inMultiline: MultilineDelim | null = null
  let offset = 0
  for (const line of raw.split('\n')) {
    const start = offset
    offset += line.length + 1
    if (inMultiline) {
      if (line.includes(inMultiline)) inMultiline = null
      continue
    }
    inMultiline = opensMultiline(line)
    if (inMultiline) continue
    const trimmed = line.trim()
    tokens.push({ kind: classifyLine(trimmed), trimmed, start })
  }
  return tokens
}

function scanTables(raw: string, prefix: string): TableSpan[] {
  const spans: TableSpan[] = []
  let current: { name: string; start: number } | null = null
  /**
   * Start of the run of comment and blank lines immediately before the
   * token being read, or null when the previous one was content.
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

  for (const token of tokenizeLines(raw)) {
    if (token.kind === 'filler') {
      runStart ??= token.start
      continue
    }
    if (token.kind === 'content') {
      runStart = null
      continue
    }
    // Any header at any level ends the table in progress.
    closeCurrent(runStart ?? token.start)
    runStart = null
    if (token.kind === 'header') {
      const bare = stripComment(token.trimmed).trim()
      const path = parseHeaderPath(bare.slice(1, -1))
      if (path.length === 2 && path[0] === prefix) {
        current = { name: path[1] as string, start: token.start }
      }
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
