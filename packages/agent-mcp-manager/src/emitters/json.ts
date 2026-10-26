import { applyEdits, modify, parse } from 'jsonc-parser'

import type { McpServerSpec } from '../types.ts'
import { buildEntryValue, type ResolvedShapes, transformKey } from './shape.ts'

const FORMATTING = {
  formattingOptions: { tabSize: 2, insertSpaces: true },
} as const

/**
 * JSON / JSONC config emitter. Uses `jsonc-parser` to preserve
 * comments and formatting of the target file across edits.
 */

export function jsonRead(raw: string, shapes: ResolvedShapes): string[] {
  if (!raw.trim()) return []
  let parsed: unknown
  try {
    parsed = parse(raw)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') return []
  let container: unknown = parsed
  for (const segment of shapes.containerPath) {
    if (!container || typeof container !== 'object') return []
    container = (container as Record<string, unknown>)[segment]
  }
  if (!container || typeof container !== 'object') return []
  return Object.keys(container as Record<string, unknown>)
}

export function jsonAdd(
  raw: string,
  name: string,
  spec: McpServerSpec,
  shapes: ResolvedShapes,
): string {
  const seed = raw.trim() ? raw : '{}'
  const key = transformKey(name, shapes.stdio)
  const value = buildEntryValue(spec, shapes)
  // `modify` creates the intermediate objects along the path, so a nested
  // container needs no special handling here.
  const edits = modify(seed, [...shapes.containerPath, key], value, FORMATTING)
  return applyEdits(seed, edits)
}

export function jsonRemove(
  raw: string,
  name: string,
  shapes: ResolvedShapes,
): string {
  if (!raw.trim()) return raw
  const key = transformKey(name, shapes.stdio)
  const edits = modify(
    raw,
    [...shapes.containerPath, key],
    undefined,
    FORMATTING,
  )
  return applyEdits(raw, edits)
}
