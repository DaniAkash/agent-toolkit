import YAML from 'yaml'

import type { McpServerSpec } from '../types.ts'
import { buildEntryValue, type ResolvedShapes, transformKey } from './shape.ts'

/**
 * YAML config emitter. Uses the `yaml` package which round-trips
 * comments and formatting through a Document API. We keep the whole
 * file as a Document object so hand-authored comments upstream survive
 * our edits.
 */

function parseDoc(raw: string): YAML.Document {
  if (!raw.trim()) return new YAML.Document({}, { keepSourceTokens: true })
  return YAML.parseDocument(raw, { keepSourceTokens: true })
}

/** Walk a containerPath through a YAML document, or undefined if absent. */
function getContainer(doc: YAML.Document, path: readonly string[]): unknown {
  return path.length === 1
    ? doc.get(path[0] as string)
    : doc.getIn(path as string[])
}

export function yamlRead(raw: string, shapes: ResolvedShapes): string[] {
  if (!raw.trim()) return []
  const doc = parseDoc(raw)
  const container = getContainer(doc, shapes.containerPath)
  if (!YAML.isMap(container)) return []
  return container.items
    .map((item) =>
      YAML.isScalar(item.key) ? String(item.key.value) : String(item.key),
    )
    .filter((k) => k.length > 0)
}

export function yamlAdd(
  raw: string,
  name: string,
  spec: McpServerSpec,
  shapes: ResolvedShapes,
): string {
  const doc = parseDoc(raw)
  const key = transformKey(name, shapes.stdio)
  const value = buildEntryValue(spec, shapes)
  const container = getContainer(doc, shapes.containerPath)
  if (YAML.isMap(container)) {
    container.set(key, value)
  } else if (shapes.containerPath.length === 1) {
    doc.set(shapes.containerPath[0] as string, { [key]: value })
  } else {
    doc.setIn(shapes.containerPath as string[], { [key]: value })
  }
  return String(doc)
}

export function yamlRemove(
  raw: string,
  name: string,
  shapes: ResolvedShapes,
): string {
  if (!raw.trim()) return raw
  const doc = parseDoc(raw)
  const key = transformKey(name, shapes.stdio)
  const container = getContainer(doc, shapes.containerPath)
  if (YAML.isMap(container)) {
    container.delete(key)
    if (container.items.length === 0) {
      if (shapes.containerPath.length === 1) {
        doc.delete(shapes.containerPath[0] as string)
      } else {
        doc.deleteIn(shapes.containerPath as string[])
      }
    }
  }
  return String(doc)
}
