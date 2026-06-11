import { applyEdits, modify, parse } from 'jsonc-parser'

import type { JsonEmitterConfig } from '../_vendor/catalog.ts'
import type { McpServerSpec } from '../types.ts'

const FORMATTING = {
  formattingOptions: { tabSize: 2, insertSpaces: true },
} as const

function specToValue(
  spec: McpServerSpec,
  inject: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    spec.transport === 'stdio'
      ? {
          command: spec.command,
          ...(spec.args ? { args: spec.args } : {}),
          ...(spec.env ? { env: spec.env } : {}),
        }
      : { url: spec.url, ...(spec.headers ? { headers: spec.headers } : {}) }
  return inject ? { ...base, ...inject } : base
}

export function jsonRead(raw: string, config: JsonEmitterConfig): string[] {
  if (!raw.trim()) return []
  let parsed: unknown
  try {
    parsed = parse(raw)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') return []
  const container = (parsed as Record<string, unknown>)[config.parentKey]
  if (!container || typeof container !== 'object') return []
  return Object.keys(container as Record<string, unknown>)
}

export function jsonAdd(
  raw: string,
  name: string,
  spec: McpServerSpec,
  config: JsonEmitterConfig,
): string {
  const seed = raw.trim() ? raw : '{}'
  const value = specToValue(spec, config.injectFields)
  const edits = modify(seed, [config.parentKey, name], value, FORMATTING)
  return applyEdits(seed, edits)
}

export function jsonRemove(
  raw: string,
  name: string,
  config: JsonEmitterConfig,
): string {
  if (!raw.trim()) return raw
  const edits = modify(raw, [config.parentKey, name], undefined, FORMATTING)
  return applyEdits(raw, edits)
}
