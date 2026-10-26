/**
 * Data-driven entry builder. Given a McpServerSpec and the resolved
 * StdioShape / HttpShape for the target client + scope, produce the
 * concrete object we serialise into the client's config file.
 *
 * The format-specific emitters (json.ts, yaml.ts, toml.ts) all use
 * this. Emitters only know how to (de)serialise; every per-client
 * quirk (parent key, field renames, tag key/value, injects, command-
 * as-array, key transform) lives here.
 */

import type { ClientConfig, HttpShape, StdioShape } from '../_catalog/types.ts'
import { InvalidServerSpecError } from '../errors.ts'
import type { AgentScope, McpServerSpec } from '../types.ts'

export interface ResolvedShapes {
  /**
   * First segment of {@link containerPath}. Retained because the TOML
   * emitter addresses tables by their top-level name, and every client
   * except Claude Code's `local` scope has a one-segment path.
   */
  topLevelKey: string
  /**
   * Path to the object holding the server entries, walked segment by
   * segment from the document root. `['mcpServers']` for most clients;
   * `['projects', '<root>', 'mcpServers']` for Claude Code's `local`
   * scope, where two scopes share one file and only the container tells
   * them apart. A plain key cannot express that.
   */
  containerPath: readonly string[]
  stdio: StdioShape
  http?: HttpShape
}

/**
 * Pick the pair of shapes that apply to this client + scope. Project
 * scope falls back to system scope when the client does not declare a
 * project-specific override.
 */
export function resolveShapes(
  client: ClientConfig,
  scope: AgentScope,
  projectRoot?: string,
): ResolvedShapes {
  if (scope === 'project' && client.project) {
    return {
      topLevelKey: client.project.stdio.topLevelKey,
      containerPath: containerPathFor(client.project.stdio, projectRoot),
      stdio: client.project.stdio,
      http: client.project.http,
    }
  }
  if (scope === 'local' && client.local) {
    return {
      topLevelKey: client.local.stdio.topLevelKey,
      containerPath: containerPathFor(client.local.stdio, projectRoot),
      stdio: client.local.stdio,
      http: client.local.http,
    }
  }
  return {
    topLevelKey: client.stdio.topLevelKey,
    containerPath: containerPathFor(client.stdio, projectRoot),
    stdio: client.stdio,
    http: client.http,
  }
}

/**
 * Expand a shape's declared container into a concrete path.
 *
 * The catalog stays plain data, so a path segment that depends on the
 * caller is written as the literal token `{projectRoot}` and substituted
 * here rather than stored as a function.
 */
function containerPathFor(
  shape: StdioShape,
  projectRoot: string | undefined,
): readonly string[] {
  const declared = shape.containerPath ?? [shape.topLevelKey]
  return declared.map((segment) => {
    if (segment !== PROJECT_ROOT_TOKEN) return segment
    if (!projectRoot) {
      throw new InvalidServerSpecError(
        'this scope addresses entries by project root, so projectRoot is required',
      )
    }
    return projectRoot
  })
}

/** Placeholder for the caller's project root inside a `containerPath`. */
export const PROJECT_ROOT_TOKEN = '{projectRoot}'

/**
 * Transform the caller-supplied entry key (server name) per the shape's
 * keyTransform, if any. Currently the only supported transform is
 * `simpleName`, which lowercases the input and strips every non-letter
 * (matches Docker/Goose semantics: `MCP_DOCKER` becomes `mcpdocker`).
 */
export function transformKey(
  name: string,
  shape: StdioShape | undefined,
): string {
  if (shape?.keyTransform === 'simpleName') {
    return name.toLowerCase().replace(/[^a-z]/g, '')
  }
  return name
}

/**
 * Build the entry object for one server. The returned value goes
 * verbatim under `topLevelKey.<transformed name>` in the config file.
 */
export function buildEntryValue(
  spec: McpServerSpec,
  shapes: ResolvedShapes,
): Record<string, unknown> {
  if (spec.transport === 'stdio') {
    return buildStdioEntry(spec, shapes.stdio)
  }
  if (!shapes.http) {
    throw new InvalidServerSpecError(
      `client does not accept ${spec.transport} entries at this scope`,
    )
  }
  return buildHttpEntry(spec, shapes.http)
}

function buildStdioEntry(
  spec: Extract<McpServerSpec, { transport: 'stdio' }>,
  shape: StdioShape,
): Record<string, unknown> {
  const commandField = shape.commandField ?? 'command'
  const argsField = shape.argsField ?? 'args'
  const envField = shape.envField ?? 'env'

  const base: Record<string, unknown> = {}
  if (shape.commandAsArray) {
    const parts: string[] = [spec.command, ...(spec.args ?? [])]
    base[commandField] = parts
  } else {
    base[commandField] = spec.command
    if (spec.args && spec.args.length > 0) base[argsField] = spec.args
  }
  if (spec.env && Object.keys(spec.env).length > 0) {
    base[envField] = spec.env
  }
  return finaliseEntry(base, shape.injects, shape.tagKey, shape.tagValue)
}

function buildHttpEntry(
  spec: Extract<McpServerSpec, { transport: 'sse' | 'http' }>,
  shape: HttpShape,
): Record<string, unknown> {
  const urlField = shape.urlField ?? 'url'
  const headerField = shape.headerField ?? 'headers'

  const base: Record<string, unknown> = {}
  base[urlField] = spec.url
  if (spec.headers && Object.keys(spec.headers).length > 0) {
    base[headerField] = spec.headers
  }
  // Tag value resolution: `sseTagValue` overrides `tagValue` for sse
  // entries when set. Used by clients like Claude Code that write
  // `type: "http"` for http entries and `type: "sse"` for sse entries.
  // Clients that use the same tag value regardless (Cursor, VS Code,
  // ...) keep `tagValue: 'http'` and omit `sseTagValue`.
  const tagValue =
    spec.transport === 'sse' && shape.sseTagValue !== undefined
      ? shape.sseTagValue
      : shape.tagValue
  return finaliseEntry(base, shape.injects, shape.tagKey, tagValue)
}

function finaliseEntry(
  base: Record<string, unknown>,
  injects: Record<string, unknown> | undefined,
  tagKey: 'type' | 'transport' | undefined,
  tagValue: string | undefined,
): Record<string, unknown> {
  const withInjects = injects ? { ...base, ...injects } : base
  if (tagKey && tagValue !== undefined) {
    return { ...withInjects, [tagKey]: tagValue }
  }
  return withInjects
}
