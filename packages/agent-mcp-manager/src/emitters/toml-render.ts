/**
 * TOML serialisation primitives for the Codex emitter.
 *
 * Split from `toml.ts` so that locating a table (a lexical concern) and
 * writing one (a serialisation concern) stay separable. Only the values
 * the catalog's entry builder can produce are handled: strings, booleans,
 * numbers, string arrays and one level of inline table.
 */

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
export function renderTable(
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

/** Is this value a plain object (a TOML table), not an array? */
function isTable(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Render one top-level key as either a scalar line or one or more tables. */
function renderTopLevel(
  key: string,
  value: unknown,
): { scalar?: string; tables: string[] } {
  if (!isTable(value)) {
    return { scalar: `${renderKey(key)} = ${renderValue(value)}`, tables: [] }
  }
  const entries = Object.entries(value)
  const allTables =
    entries.length > 0 && entries.every(([, child]) => isTable(child))
  if (allTables) {
    return {
      tables: entries.map(([childKey, child]) =>
        renderTable(key, childKey, child as Record<string, unknown>),
      ),
    }
  }
  const body = entries
    .map(
      ([childKey, child]) => `${renderKey(childKey)} = ${renderValue(child)}`,
    )
    .join('\n')
  return { tables: [`[${renderKey(key)}]\n${body}\n`] }
}

/**
 * Last-resort full rewrite, for a config whose entries are inline tables
 * rather than `[prefix.name]` headers. Loses comments, which is why every
 * other path avoids it.
 */
export function rewriteWhole(
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
  for (const [topKey, value] of Object.entries(next)) {
    const rendered = renderTopLevel(topKey, value)
    if (rendered.scalar !== undefined) scalars.push(rendered.scalar)
    tables.push(...rendered.tables)
  }
  const head = scalars.length > 0 ? `${scalars.join('\n')}\n` : ''
  const body = tables.join('\n')
  return head && body ? `${head}\n${body}` : head || body
}
