import * as os from 'node:os'
import * as path from 'node:path'
import { atomicWriteFile, readFileOrEmpty } from './_internal/atomic-write.ts'
import { readManifest, writeManifest } from './_internal/manifest.ts'
import {
  getCatalogEntry,
  isAgentSupported,
  resolveAgentMcpConfigPath,
} from './agents.ts'
import { getEmitter } from './emitters/index.ts'
import {
  AgentNotSupportedError,
  ForeignEntryError,
  InvalidServerSpecError,
  McpManagerError,
  ServerNotFoundError,
} from './errors.ts'
import type {
  AddServerOptions,
  AddServerResult,
  AgentId,
  AgentScope,
  InstalledServer,
  LinkServerOptions,
  LinkServerResult,
  ListLinksOptions,
  ListServersOptions,
  ManifestServerEntry,
  McpManagerOptions,
  McpServerLink,
  McpServerSpec,
  RemoveServerOptions,
  RescanOptions,
  RescanResult,
  ServerManifest,
  UnlinkServerOptions,
  UnlinkServerResult,
} from './types.ts'

export interface McpManager {
  add(opts: AddServerOptions): Promise<AddServerResult>
  link(opts: LinkServerOptions): Promise<LinkServerResult>
  unlink(opts: UnlinkServerOptions): Promise<UnlinkServerResult>
  remove(opts: RemoveServerOptions): Promise<void>
  listServers(opts?: ListServersOptions): Promise<InstalledServer[]>
  listLinks(opts?: ListLinksOptions): Promise<McpServerLink[]>
  rescan(opts?: RescanOptions): Promise<RescanResult>
}

const ALL_AGENT_IDS: readonly AgentId[] = [
  'claude-code',
  'claude-desktop',
  'cursor',
  'vscode',
  'gemini',
  'codex',
  'zed',
]

function defaultWorkspaceDir(): string {
  return path.join(os.homedir(), '.acpx', 'mcp')
}

function validateSpec(spec: McpServerSpec): void {
  if (!spec || typeof spec !== 'object') {
    throw new InvalidServerSpecError('spec is required')
  }
  if (spec.transport === 'stdio') {
    if (!spec.command?.trim()) {
      throw new InvalidServerSpecError(
        'stdio.command is required and must be non-empty',
      )
    }
    return
  }
  if (spec.transport === 'sse' || spec.transport === 'http') {
    if (!spec.url?.trim()) {
      throw new InvalidServerSpecError(`${spec.transport}.url is required`)
    }
    try {
      // eslint-disable-next-line no-new
      new URL(spec.url)
    } catch {
      throw new InvalidServerSpecError(
        `${spec.transport}.url is not a valid URL`,
      )
    }
    return
  }
  throw new InvalidServerSpecError(
    `unknown transport "${(spec as { transport?: string }).transport ?? ''}"`,
  )
}

function validateName(name: string): string {
  if (typeof name !== 'string')
    throw new InvalidServerSpecError('name must be a string')
  const trimmed = name.trim()
  if (trimmed.length === 0)
    throw new InvalidServerSpecError('name must be non-empty')
  return trimmed
}

function assertSupported(agent: string): asserts agent is AgentId {
  if (!isAgentSupported(agent)) throw new AgentNotSupportedError(agent)
}

function withoutAgent<T>(
  links: Partial<Record<AgentId, T>>,
  agent: AgentId,
): Partial<Record<AgentId, T>> {
  const out: Partial<Record<AgentId, T>> = {}
  for (const [k, v] of Object.entries(links)) {
    if (k === agent) continue
    out[k as AgentId] = v as T
  }
  return out
}

function withoutServer(
  servers: Record<string, ManifestServerEntry>,
  name: string,
): Record<string, ManifestServerEntry> {
  const out: Record<string, ManifestServerEntry> = {}
  for (const [k, v] of Object.entries(servers)) {
    if (k === name) continue
    out[k] = v
  }
  return out
}

interface InternalCtx {
  workspaceDir: string
  scope: AgentScope
  projectRoot?: string
  overrides: Partial<Record<AgentId, string>>
}

async function resolvePath(
  ctx: InternalCtx,
  agent: AgentId,
  override?: string,
): Promise<string> {
  if (override) return override
  const mapped = ctx.overrides[agent]
  if (mapped) return mapped
  return resolveAgentMcpConfigPath(agent, ctx.scope, ctx.projectRoot)
}

async function unlinkImpl(
  ctx: InternalCtx,
  opts: UnlinkServerOptions,
): Promise<UnlinkServerResult> {
  const name = validateName(opts.serverName)
  assertSupported(opts.agent)
  const entry = getCatalogEntry(opts.agent)
  const emitter = getEmitter(entry)

  const manifest = await readManifest(ctx.workspaceDir)
  const server = manifest.servers[name]
  const recorded = server?.links[opts.agent]
  const configPath = await resolvePath(
    ctx,
    opts.agent,
    opts.configPath ?? recorded?.configPath,
  )

  const raw = await readFileOrEmpty(configPath)
  const onDisk = raw.trim() ? emitter.read(raw).includes(name) : false

  if (!onDisk) {
    if (recorded && server) {
      const next: ServerManifest = {
        ...manifest,
        servers: {
          ...manifest.servers,
          [name]: { ...server, links: withoutAgent(server.links, opts.agent) },
        },
      }
      await writeManifest(ctx.workspaceDir, next)
    }
    return { serverName: name, agent: opts.agent, configPath, removed: false }
  }

  if (!recorded) {
    throw new ForeignEntryError(name, opts.agent, configPath)
  }

  const next = emitter.remove(raw, name)
  if (next !== raw) await atomicWriteFile(configPath, next)

  if (server) {
    const nextManifest: ServerManifest = {
      ...manifest,
      servers: {
        ...manifest.servers,
        [name]: { ...server, links: withoutAgent(server.links, opts.agent) },
      },
    }
    await writeManifest(ctx.workspaceDir, nextManifest)
  }

  return { serverName: name, agent: opts.agent, configPath, removed: true }
}

async function scanUnmanaged(
  ctx: InternalCtx,
  manifest: ServerManifest,
  agentFilter?: AgentId[],
): Promise<McpServerLink[]> {
  const out: McpServerLink[] = []
  const agents = agentFilter ?? ALL_AGENT_IDS
  const recordedByPath = new Map<string, Set<string>>()
  for (const server of Object.values(manifest.servers)) {
    for (const [agentRaw, link] of Object.entries(server.links)) {
      if (!link) continue
      const key = `${agentRaw}:${link.configPath}`
      let set = recordedByPath.get(key)
      if (!set) {
        set = new Set()
        recordedByPath.set(key, set)
      }
      set.add(server.name)
    }
  }
  for (const agent of agents) {
    const entry = getCatalogEntry(agent)
    const emitter = getEmitter(entry)
    let configPath: string
    try {
      configPath = await resolvePath(ctx, agent)
    } catch {
      continue
    }
    const raw = await readFileOrEmpty(configPath)
    if (!raw.trim()) continue
    const onDisk = emitter.read(raw)
    const recorded =
      recordedByPath.get(`${agent}:${configPath}`) ?? new Set<string>()
    for (const name of onDisk) {
      if (recorded.has(name)) continue
      out.push({
        serverName: name,
        agent,
        configPath,
        unmanaged: true,
      })
    }
  }
  return out
}

export function createMcpManager(options: McpManagerOptions = {}): McpManager {
  const ctx: InternalCtx = {
    workspaceDir: options.workspaceDir ?? defaultWorkspaceDir(),
    scope: options.scope ?? 'system',
    projectRoot: options.projectRoot,
    overrides: options.agentConfigPaths ?? {},
  }

  return {
    async add(opts: AddServerOptions): Promise<AddServerResult> {
      const name = validateName(opts.name)
      validateSpec(opts.spec)
      const manifest = await readManifest(ctx.workspaceDir)
      const existing = manifest.servers[name]
      const next: ManifestServerEntry = {
        name,
        spec: opts.spec,
        addedAt: existing?.addedAt ?? new Date().toISOString(),
        links: existing?.links ?? {},
      }
      const updated: ServerManifest = {
        ...manifest,
        servers: { ...manifest.servers, [name]: next },
      }
      await writeManifest(ctx.workspaceDir, updated)
      return { name, created: !existing }
    },

    async link(opts: LinkServerOptions): Promise<LinkServerResult> {
      const name = validateName(opts.serverName)
      assertSupported(opts.agent)
      const entry = getCatalogEntry(opts.agent)
      const emitter = getEmitter(entry)
      const configPath = await resolvePath(ctx, opts.agent, opts.configPath)

      const manifest = await readManifest(ctx.workspaceDir)
      const server = manifest.servers[name]
      if (!server) throw new ServerNotFoundError(name)

      const raw = await readFileOrEmpty(configPath)
      const existing = server.links[opts.agent]
      const alreadyOnDisk = raw.trim()
        ? emitter.read(raw).includes(name)
        : false
      if (existing && existing.configPath === configPath && alreadyOnDisk) {
        return {
          serverName: name,
          agent: opts.agent,
          configPath,
          created: false,
        }
      }

      const updated = emitter.add(raw, name, server.spec)
      if (updated !== raw) await atomicWriteFile(configPath, updated)

      const nextManifest: ServerManifest = {
        ...manifest,
        servers: {
          ...manifest.servers,
          [name]: {
            ...server,
            links: {
              ...server.links,
              [opts.agent]: {
                configPath,
                createdAt: new Date().toISOString(),
              },
            },
          },
        },
      }
      await writeManifest(ctx.workspaceDir, nextManifest)
      return { serverName: name, agent: opts.agent, configPath, created: true }
    },

    unlink: (opts) => unlinkImpl(ctx, opts),

    async remove(opts: RemoveServerOptions): Promise<void> {
      const name = validateName(opts.serverName)
      const manifest = await readManifest(ctx.workspaceDir)
      const server = manifest.servers[name]
      if (!server) throw new ServerNotFoundError(name)

      if (opts.unlinkFirst !== false) {
        for (const agent of Object.keys(server.links) as AgentId[]) {
          try {
            await unlinkImpl(ctx, { serverName: name, agent })
          } catch (err) {
            if (err instanceof ForeignEntryError) continue
            throw err
          }
        }
      }

      const fresh = await readManifest(ctx.workspaceDir)
      await writeManifest(ctx.workspaceDir, {
        ...fresh,
        servers: withoutServer(fresh.servers, name),
      })
    },

    async listServers(
      _opts: ListServersOptions = {},
    ): Promise<InstalledServer[]> {
      const manifest = await readManifest(ctx.workspaceDir)
      return Object.values(manifest.servers).map((s) => ({
        name: s.name,
        spec: s.spec,
        addedAt: s.addedAt,
        links: s.links,
      }))
    },

    async listLinks(opts: ListLinksOptions = {}): Promise<McpServerLink[]> {
      const manifest = await readManifest(ctx.workspaceDir)
      const out: McpServerLink[] = []
      const filterAgents = opts.agents ? new Set(opts.agents) : null
      const filterNames = opts.serverNames ? new Set(opts.serverNames) : null
      for (const server of Object.values(manifest.servers)) {
        if (filterNames && !filterNames.has(server.name)) continue
        for (const [agentRaw, link] of Object.entries(server.links)) {
          const agent = agentRaw as AgentId
          if (filterAgents && !filterAgents.has(agent)) continue
          if (!link) continue
          out.push({
            serverName: server.name,
            agent,
            configPath: link.configPath,
          })
        }
      }
      if (opts.scanUnmanaged) {
        for (const link of await scanUnmanaged(ctx, manifest, opts.agents))
          out.push(link)
      }
      return out
    },

    async rescan(opts: RescanOptions = {}): Promise<RescanResult> {
      const mode = opts.mode ?? 'merge'
      if (mode === 'replace') {
        throw new McpManagerError(
          "rescan mode 'replace' is not implemented; use 'merge'",
        )
      }
      const manifest = await readManifest(ctx.workspaceDir)
      const verified: McpServerLink[] = []
      const broken: McpServerLink[] = []

      for (const server of Object.values(manifest.servers)) {
        for (const [agentRaw, link] of Object.entries(server.links)) {
          const agent = agentRaw as AgentId
          if (!link) continue
          const entry = getCatalogEntry(agent)
          const emitter = getEmitter(entry)
          const raw = await readFileOrEmpty(link.configPath)
          const names = raw.trim() ? emitter.read(raw) : []
          if (!names.includes(server.name)) {
            broken.push({
              serverName: server.name,
              agent,
              configPath: link.configPath,
              broken: true,
            })
            continue
          }
          verified.push({
            serverName: server.name,
            agent,
            configPath: link.configPath,
          })
        }
      }

      const unmanaged = await scanUnmanaged(ctx, manifest)

      // Drift detection (deep compare of spec) deferred to v0.2.
      return { verified, drifted: [], broken, unmanaged }
    },
  }
}
