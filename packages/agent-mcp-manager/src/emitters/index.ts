import type {
  CatalogEntry,
  EmitterConfig,
  JsonEmitterConfig,
  TomlCodexEmitterConfig,
} from '../_vendor/catalog.ts'
import type { AgentScope, McpServerSpec } from '../types.ts'
import { jsonAdd, jsonRead, jsonRemove } from './json-emitter.ts'
import {
  tomlCodexAdd,
  tomlCodexRead,
  tomlCodexRemove,
} from './toml-codex-emitter.ts'

export interface EmitterIO {
  read(raw: string): string[]
  add(raw: string, name: string, spec: McpServerSpec): string
  remove(raw: string, name: string): string
}

function pickEmitterConfig(
  entry: CatalogEntry,
  scope: AgentScope,
): EmitterConfig {
  if (scope === 'project' && entry.projectEmitterConfig) {
    return entry.projectEmitterConfig
  }
  return entry.emitterConfig
}

export function getEmitter(
  entry: CatalogEntry,
  scope: AgentScope = 'system',
): EmitterIO {
  if (entry.emitterId === 'json') {
    const config = pickEmitterConfig(entry, scope) as JsonEmitterConfig
    return {
      read: (raw) => jsonRead(raw, config),
      add: (raw, name, spec) => jsonAdd(raw, name, spec, config),
      remove: (raw, name) => jsonRemove(raw, name, config),
    }
  }
  // toml-codex
  const config = pickEmitterConfig(entry, scope) as TomlCodexEmitterConfig
  return {
    read: (raw) => tomlCodexRead(raw, config),
    add: (raw, name, spec) => tomlCodexAdd(raw, name, spec, config),
    remove: (raw, name) => tomlCodexRemove(raw, name, config),
  }
}
