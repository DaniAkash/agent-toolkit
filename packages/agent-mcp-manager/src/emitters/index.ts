import type {
  CatalogEntry,
  JsonEmitterConfig,
  TomlCodexEmitterConfig,
} from '../_vendor/catalog.ts'
import type { McpServerSpec } from '../types.ts'
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

export function getEmitter(entry: CatalogEntry): EmitterIO {
  if (entry.emitterId === 'json') {
    const config = entry.emitterConfig as JsonEmitterConfig
    return {
      read: (raw) => jsonRead(raw, config),
      add: (raw, name, spec) => jsonAdd(raw, name, spec, config),
      remove: (raw, name) => jsonRemove(raw, name, config),
    }
  }
  // toml-codex
  const config = entry.emitterConfig as TomlCodexEmitterConfig
  return {
    read: (raw) => tomlCodexRead(raw, config),
    add: (raw, name, spec) => tomlCodexAdd(raw, name, spec, config),
    remove: (raw, name) => tomlCodexRemove(raw, name, config),
  }
}
