import { EventEmitter } from 'node:events'
import os from 'node:os'
import path from 'node:path'
import type {
  AcpRuntime,
  AcpRuntimeAvailableCommand,
  AcpRuntimeCapabilities,
  AcpRuntimeDoctorReport,
  AcpRuntimeEvent,
  AcpRuntimeHandle,
  AcpRuntimeOptions,
  AcpRuntimePlanEntry,
  AcpRuntimeSessionModels,
} from 'acpx/runtime'
import {
  createAcpRuntime,
  createAgentRegistry,
  createFileSessionStore,
} from 'acpx/runtime'
import type { HostToolServer } from './host-tools/serve.ts'
import { startHostToolServer } from './host-tools/serve.ts'
import { AcpxLanguageModel } from './language-model.ts'
import { toRuntimeMcpServers } from './mcp-servers.ts'

/**
 * Advertised in the MCP `initialize` response. Independent of the package
 * version on purpose: it describes the tool server's own surface, which
 * changes on its own schedule.
 */
const HOST_TOOL_SERVER_VERSION = '1'

import type {
  AcpxLanguageModelOptions,
  AcpxProviderSettings,
  AcpxSessionMode,
  AcpxUsageSnapshot,
} from './types.ts'

const DEFAULT_PERMISSION_MODE = 'approve-reads'
const DEFAULT_NON_INTERACTIVE = 'deny'

interface ResolvedHandle {
  handle: AcpRuntimeHandle
  agent: string
}

export interface EnsureHandleResult {
  handle: AcpRuntimeHandle
  sessionKey: string
  mode: AcpxSessionMode
  isFresh: boolean
}

export interface AcpxProviderEvents {
  usage: [AcpxUsageSnapshot]
  availableCommands: [
    { sessionKey: string; commands: AcpRuntimeAvailableCommand[] },
  ]
  plan: [{ sessionKey: string; entries: AcpRuntimePlanEntry[] }]
}

/** Separators agents have been observed using between namespace segments. */
const NAME_SEPARATORS = ['__', '.', '/', '-', ':']

/**
 * True when `reported` is `tool`, or `tool` prefixed by the server name
 * with any of the observed separators between the segments.
 */
/**
 * True when `reported` is `tool` prefixed by the server name with any of
 * the observed separators. The bare-name case is deliberately NOT handled
 * here: it cannot be told apart from an agent's own tool of the same name
 * by shape alone, so the caller decides it from what was actually served.
 */
function matchesNamespacedHostTool(
  reported: string,
  serverName: string,
  tool: string,
): boolean {
  for (const sep of NAME_SEPARATORS) {
    const tail = `${serverName}${sep}${tool}`
    if (reported === tail) return true
    // Allow a leading namespace of its own, e.g. `mcp__host__say`.
    for (const lead of NAME_SEPARATORS) {
      if (reported.endsWith(`${lead}${tail}`)) return true
    }
  }
  return false
}

export class AcpxProvider {
  readonly settings: AcpxProviderSettings
  readonly generateId: () => string
  readonly events: EventEmitter<AcpxProviderEvents> =
    new EventEmitter<AcpxProviderEvents>()

  private runtimeInstance: AcpRuntime | null
  private readonly handles = new Map<string, ResolvedHandle>()
  private readonly usedKeys = new Set<string>()
  /**
   * One host tool server per session, not per turn: ACP fixes a session's
   * MCP configuration at `session/new`, so the server has to be bound and
   * reachable before `ensureSession` and lives as long as the session.
   */
  private readonly hostToolServers = new Map<string, HostToolServer>()
  /**
   * Abort controller for the turn currently in flight on a session, so a
   * pending host tool call is cancelled when the turn is.
   */
  /**
   * Live turns per session, as a stack. The provider permits concurrent
   * turns on one session key, so a single controller per session let one
   * turn's completion abort another turn's pending host call.
   */
  private readonly turnAborts = new Map<
    string,
    Array<{ token: number; controller: AbortController }>
  >()
  private turnCounter = 0
  /** In-flight `startHostToolServer` calls, keyed by session. */
  private readonly hostToolServerStarts = new Map<string, Promise<void>>()
  /**
   * Tool names this session actually served, recorded by the server's
   * `onCall`. A bare (unnamespaced) reported name is only credited to us
   * when it appears here.
   */
  private readonly hostToolCalls = new Map<string, Set<string>>()
  private readonly lastPlan = new Map<string, AcpRuntimePlanEntry[]>()
  private readonly lastUsage = new Map<string, AcpxUsageSnapshot>()
  private readonly lastCommands = new Map<
    string,
    AcpRuntimeAvailableCommand[]
  >()

  constructor(settings: AcpxProviderSettings) {
    this.settings = settings
    this.runtimeInstance = settings.runtime ?? null
    this.generateId = settings._internal?.generateId ?? defaultIdGen()
  }

  get runtime(): AcpRuntime {
    if (!this.runtimeInstance) {
      const options = this.buildRuntimeOptions()
      const create = this.settings._internal?.createRuntime ?? createAcpRuntime
      this.runtimeInstance = create(options)
    }
    return this.runtimeInstance
  }

  languageModel(
    _modelId?: string,
    opts: AcpxLanguageModelOptions = {},
  ): AcpxLanguageModel {
    return new AcpxLanguageModel(this, opts)
  }

  async prepare(
    opts: AcpxLanguageModelOptions = {},
  ): Promise<AcpRuntimeHandle> {
    const { handle } = await this.ensureHandle(opts)
    return handle
  }

  async ensureHandle(
    opts: AcpxLanguageModelOptions = {},
  ): Promise<EnsureHandleResult> {
    const sessionKey = this.resolveSessionKey(opts)
    const agent = opts.agent ?? this.settings.agent
    const mode: AcpxSessionMode = this.settings.sessionMode ?? 'persistent'

    let cached = this.handles.get(sessionKey)
    if (!cached || cached.agent !== agent) {
      // Before ensureSession, never after: the server's URL has to be in
      // the session/new payload, and acpx cannot swap MCP config on a live
      // session.
      await this.ensureHostToolServer(sessionKey)
      const handle = await this.runtime.ensureSession({
        sessionKey,
        agent,
        mode,
        cwd: this.settings.cwd,
        resumeSessionId: this.settings.resumeSessionId,
        sessionOptions: this.settings.sessionOptions,
      })
      cached = { handle, agent }
      this.handles.set(sessionKey, cached)
    }

    // acpx 0.21 stopped streaming `available_commands_update` for codex and
    // surfaces the same list on `getStatus()` instead. Seed from there when
    // nothing has arrived by event, so `getAvailableCommands` and `compact`
    // keep working on both shapes.
    if (!this.lastCommands.has(sessionKey)) {
      await this.syncAvailableCommandsFromStatus(sessionKey, cached.handle)
    }

    const isFresh = !this.usedKeys.has(sessionKey)
    return { handle: cached.handle, sessionKey, mode, isFresh }
  }

  /**
   * Read the agent's advertised commands off session status. Best effort: a
   * runtime without `getStatus`, or a status without a command list, leaves
   * the cache untouched so the event path still wins when it fires.
   */
  private async syncAvailableCommandsFromStatus(
    sessionKey: string,
    handle: AcpRuntimeHandle,
  ): Promise<void> {
    const getStatusImpl = this.runtime.getStatus
    if (!getStatusImpl) return
    try {
      const status = await getStatusImpl.call(this.runtime, { handle })
      const commands = status.availableCommands
      // Record an empty list too, rather than only a populated one. The seed
      // is guarded on the key being absent from the cache, so skipping []
      // would leave it absent and re-run getStatus on every ensureHandle for
      // any agent that advertises nothing. A later event still overwrites it.
      if (commands !== undefined) {
        this.recordAvailableCommands(sessionKey, commands)
      }
    } catch {
      // Status is an optimisation here, never a precondition for a turn.
    }
  }

  markSessionKeyUsed(sessionKey: string): boolean {
    const wasFresh = !this.usedKeys.has(sessionKey)
    this.usedKeys.add(sessionKey)
    return wasFresh
  }

  resolveSessionKey(opts: AcpxLanguageModelOptions): string {
    if (opts.sessionKey) return opts.sessionKey
    if (this.settings.sessionKey) return this.settings.sessionKey
    const cwd = this.settings.cwd ?? process.cwd()
    const agent = opts.agent ?? this.settings.agent
    return `${agent}::${cwd}`
  }

  async cancel(reason = 'cancel'): Promise<void> {
    for (const [, { handle }] of this.handles) {
      await this.runtime.cancel({ handle, reason })
    }
  }

  async close(reason = 'close'): Promise<void> {
    for (const [key, { handle }] of this.handles) {
      await this.runtime.close({
        handle,
        reason,
        discardPersistentState: false,
      })
      this.usedKeys.delete(key)
    }
    this.handles.clear()

    // Abort BEFORE closing the listeners, not after. A host tool waiting
    // on a human keeps its `tools/call` request active, and the Node
    // listener's `close()` waits for active requests, so closing first
    // made `close()` hang forever on exactly the case host tools exist
    // for. Aborting gives the tool its cancellation and lets the request
    // finish.
    for (const [, live] of this.turnAborts) {
      for (const { controller } of live) {
        controller.abort(new Error(`provider closed: ${reason}`))
      }
    }
    this.turnAborts.clear()

    for (const [, server] of this.hostToolServers) await server.close()
    this.hostToolServers.clear()
    this.hostToolServerStarts.clear()
    this.hostToolCalls.clear()
  }

  /**
   * Bind this session's host tool server if the caller declared any tools
   * and it is not already up.
   *
   * Guarded by an in-flight promise rather than a bare `has` check:
   * `startHostToolServer` awaits, so two concurrent first turns on one
   * session key could both pass a check-then-await and bind two listeners,
   * the second overwriting the first in the map and leaking its port.
   */
  private async ensureHostToolServer(sessionKey: string): Promise<void> {
    const declared = this.settings.hostTools?.tools
    if (!declared || Object.keys(declared).length === 0) return
    if (this.hostToolServers.has(sessionKey)) return

    const inFlight = this.hostToolServerStarts.get(sessionKey)
    if (inFlight) {
      await inFlight
      return
    }

    // Checked here rather than only in buildRuntimeOptions, which an
    // injected runtime never reaches.
    this.assertNoHostToolNameCollision()

    const start = startHostToolServer({
      tools: declared,
      serverName: this.hostToolServerName(),
      serverVersion: HOST_TOOL_SERVER_VERSION,
      sessionKey,
      hostname: this.settings.hostTools?.hostname,
      // Read lazily: the controller for the live turn is swapped per turn,
      // so capturing one here would pin the first turn's signal forever.
      getAbortSignal: () => this.turnAbortSignal(sessionKey),
      onCall: (toolName, toolCallId) => {
        this.recordHostToolCall(sessionKey, toolName, toolCallId)
      },
    })
      .then((server) => {
        if (this.hostToolServers.has(sessionKey)) {
          // Lost a race that the lock should prevent; close the loser
          // rather than orphan its port.
          void server.close()
          return
        }
        this.hostToolServers.set(sessionKey, server)
      })
      .finally(() => {
        this.hostToolServerStarts.delete(sessionKey)
      })

    this.hostToolServerStarts.set(sessionKey, start)
    await start
  }

  private hostToolServerName(): string {
    return this.settings.hostTools?.serverName ?? 'host'
  }

  /**
   * A caller-supplied server of the same name is a loud failure.
   * Replacing theirs would break whatever it pointed at, and dropping
   * ours would make `hostTools` quietly do nothing.
   */
  private assertNoHostToolNameCollision(): void {
    const declared = this.settings.hostTools?.tools
    if (!declared || Object.keys(declared).length === 0) return
    const hostName = this.hostToolServerName()
    const configured = toRuntimeMcpServers(this.settings.mcpServers) ?? []
    if (!configured.some((s) => s.name === hostName)) return
    throw new Error(
      `mcpServers already contains a server named "${hostName}", which ` +
        'collides with the host tool server. Rename one of them, or set ' +
        'hostTools.serverName to something else.',
    )
  }

  /**
   * True when host tools were declared but this provider cannot register
   * them, because the runtime was supplied pre-built.
   *
   * `mcpServers` is set when the runtime is constructed, so a runtime the
   * provider did not build never receives the per-session resolver and the
   * agent never learns the tools exist. Surfaced as a call warning rather
   * than a throw, so injecting a runtime for an unrelated reason still
   * works, but it is never silent.
   */
  hostToolsUnregisterable(): boolean {
    return this.hasHostTools() && this.settings.runtime !== undefined
  }

  /** Host tool entries for every live session, plus the caller's own. */
  private resolveMcpServers(): AcpRuntimeOptions['mcpServers'] {
    const configured = toRuntimeMcpServers(this.settings.mcpServers) ?? []
    this.assertNoHostToolNameCollision()
    // The resolver form, so each session contributes only its own server.
    // acpx calls this per session; an array would hand every session every
    // other session's URL and token.
    return (session: { sessionKey?: string }) => {
      const key = session?.sessionKey
      const own = key ? this.hostToolServers.get(key) : undefined
      if (!own) return configured
      return [
        ...configured,
        {
          type: 'http' as const,
          name: own.serverName,
          url: own.url,
          headers: [{ name: 'Authorization', value: `Bearer ${own.token}` }],
        },
      ]
    }
  }

  /**
   * The signal a host tool call arriving now should carry: the most
   * recently started live turn on this session.
   */
  private turnAbortSignal(sessionKey: string): AbortSignal {
    const live = this.turnAborts.get(sessionKey)
    const last = live?.[live.length - 1]
    if (last) return last.controller.signal
    // No live turn. An already-aborted signal is the honest answer: a call
    // arriving outside a turn has nothing to wait for.
    const orphan = new AbortController()
    orphan.abort(new Error('no turn is in flight on this session'))
    return orphan.signal
  }

  /**
   * Called by the language model when a turn starts. Returns a token to
   * hand back to `endTurn`.
   *
   * Tracked as a per-session stack rather than one controller per session,
   * because the provider permits concurrent turns on one session key. With
   * a single slot, a second `beginTurn` overwrote the first controller and
   * the first stream's completion then aborted the second turn's pending
   * host call.
   */
  beginTurn(sessionKey: string, abortSignal?: AbortSignal): number {
    const controller = new AbortController()
    const token = ++this.turnCounter
    const live = this.turnAborts.get(sessionKey) ?? []
    live.push({ token, controller })
    this.turnAborts.set(sessionKey, live)
    if (!this.hostToolCalls.has(sessionKey)) {
      this.hostToolCalls.set(sessionKey, new Set())
    }
    if (abortSignal) {
      if (abortSignal.aborted) controller.abort(abortSignal.reason)
      else
        abortSignal.addEventListener(
          'abort',
          () => controller.abort(abortSignal.reason),
          { once: true },
        )
    }
    return token
  }

  /**
   * Called when a turn ends, so a host call left pending cannot hold host
   * code open with nothing left to answer it. Aborts only this turn's
   * controller, identified by token.
   */
  endTurn(sessionKey: string, token: number, reason = 'turn ended'): void {
    const live = this.turnAborts.get(sessionKey)
    if (!live) return
    const index = live.findIndex((entry) => entry.token === token)
    if (index === -1) return
    const [entry] = live.splice(index, 1)
    entry?.controller.abort(new Error(reason))
    if (live.length === 0) this.turnAborts.delete(sessionKey)
  }

  private recordHostToolCall(
    sessionKey: string,
    toolName: string,
    _toolCallId: string,
  ): void {
    let seen = this.hostToolCalls.get(sessionKey)
    if (!seen) {
      seen = new Set()
      this.hostToolCalls.set(sessionKey, seen)
    }
    seen.add(toolName)
  }

  /**
   * Whether a tool name the agent reported is one of this provider's host
   * tools.
   *
   * Needed because every agent renames MCP tools on the way out, and not
   * in one style: a codex run reported `mcp.host.store_value` (dots),
   * while the `mcp__host__say` and `host__say` forms use underscores.
   *
   * A namespaced form is matched structurally, anchored on the server name
   * so an agent's own `agent_store_value` is not swept up. A BARE name is
   * only honoured when this session actually served a call by that name,
   * recorded through the server's `onCall`. Without that check an agent's
   * own tool named exactly `say` would be marked as ours, which is the
   * false positive the metadata exists to avoid.
   */
  isHostTool(sessionKey: string, reportedToolName: string): boolean {
    const declared = this.settings.hostTools?.tools
    if (!declared) return false
    const serverName = this.hostToolServerName()
    const served = this.hostToolCalls.get(sessionKey)
    return Object.keys(declared).some((name) => {
      if (reportedToolName === name) return served?.has(name) === true
      return matchesNamespacedHostTool(reportedToolName, serverName, name)
    })
  }

  /** The host tool names declared on this provider, for warning checks. */
  hostToolNames(): string[] {
    return Object.keys(this.settings.hostTools?.tools ?? {})
  }

  hasHostTools(): boolean {
    return this.hostToolNames().length > 0
  }

  async setMode(mode: string): Promise<void> {
    const setModeImpl = this.runtime.setMode
    if (!setModeImpl) return
    for (const [, { handle }] of this.handles) {
      await setModeImpl.call(this.runtime, { handle, mode })
    }
  }

  /**
   * Select a model through the adapter's advertised model control, which
   * survives reconnects. Prefer this over `setConfigOption('model', id)`:
   * some agents reject `session/set_config_option`
   * for the model key, which is what forced the config-option workaround
   * before acpx exposed a first-class setter. Falls back to that workaround
   * when the runtime has no `setModel`, so older acpx keeps working.
   */
  async setModel(
    model: string,
    opts: AcpxLanguageModelOptions = {},
  ): Promise<void> {
    // Establish the session first. Without this a call on a fresh provider
    // iterates an empty handle map and silently discards the request, which
    // is what the README's one-line example would have done.
    await this.ensureHandle(opts)
    const setModelImpl = this.runtime.setModel
    if (!setModelImpl) {
      await this.setConfigOption('model', model)
      return
    }
    for (const [, { handle }] of this.handles) {
      await setModelImpl.call(this.runtime, { handle, model })
    }
  }

  /**
   * The session's advertised capabilities. Reads from the runtime rather than
   * spawning the CLI, so it costs nothing beyond the already-open session.
   */
  async getCapabilities(
    opts: AcpxLanguageModelOptions = {},
  ): Promise<AcpRuntimeCapabilities | undefined> {
    const getCapsImpl = this.runtime.getCapabilities
    if (!getCapsImpl) return undefined
    // Resolve the requested session, as getModels does. Picking the first
    // cached handle reported an arbitrary session once more than one existed,
    // and passing no handle asks the runtime for global capabilities rather
    // than the session's.
    const { handle } = await this.ensureHandle(opts)
    return await getCapsImpl.call(this.runtime, { handle })
  }

  async setConfigOption(key: string, value: string): Promise<void> {
    const setOptImpl = this.runtime.setConfigOption
    if (!setOptImpl) return
    for (const [, { handle }] of this.handles) {
      await setOptImpl.call(this.runtime, { handle, key, value })
    }
  }

  async getModels(
    opts: AcpxLanguageModelOptions = {},
  ): Promise<AcpRuntimeSessionModels | undefined> {
    const getStatusImpl = this.runtime.getStatus
    if (!getStatusImpl) return undefined
    const { handle } = await this.ensureHandle(opts)
    const status = await getStatusImpl.call(this.runtime, { handle })
    return status.models
  }

  /**
   * Latest `usage_update` snapshot observed for this session, or
   * `undefined` if no usage event has fired yet. Synchronous;
   * does not spawn an agent or query the runtime. Callers wanting
   * push updates should subscribe to `provider.events.on('usage', ...)`.
   */
  getUsage(sessionKey?: string): AcpxUsageSnapshot | undefined {
    const snapshot = this.lastUsage.get(
      sessionKey ?? this.resolveSessionKey({}),
    )
    // Defensive copy so callers cannot mutate the provider's stored state.
    return snapshot ? { ...snapshot } : undefined
  }

  /**
   * Latest list of agent-advertised slash commands for this session,
   * or `[]` if no `available_commands_update` event has fired yet.
   * Synchronous. Subscribe to `provider.events.on('availableCommands', ...)`
   * for push updates.
   */
  getAvailableCommands(sessionKey?: string): AcpRuntimeAvailableCommand[] {
    const commands = this.lastCommands.get(
      sessionKey ?? this.resolveSessionKey({}),
    )
    // Defensive copy so callers cannot mutate the provider's stored state.
    return (commands ?? []).map((c) => ({ ...c }))
  }

  /**
   * Latest plan snapshot for this session, or `[]` if the agent has not sent
   * one. A snapshot replaces the previous one rather than adding to it, and an
   * empty array means the agent cleared the plan, so an empty result is a real
   * answer and not a missing one.
   */
  getPlan(sessionKey?: string): AcpRuntimePlanEntry[] {
    const entries = this.lastPlan.get(sessionKey ?? this.resolveSessionKey({}))
    // Defensive copy so callers cannot mutate the provider's stored state.
    return (entries ?? []).map((entry) => ({ ...entry }))
  }

  /** Internal: called by the language model when an event arrives. */
  recordUsage(snapshot: AcpxUsageSnapshot): void {
    this.lastUsage.set(snapshot.sessionKey, snapshot)
    this.events.emit('usage', snapshot)
  }

  /** Internal: called by the language model when an event arrives. */
  recordPlan(sessionKey: string, entries: AcpRuntimePlanEntry[]): void {
    this.lastPlan.set(sessionKey, entries)
    this.events.emit('plan', { sessionKey, entries })
  }

  /** Internal: called by the language model when an event arrives. */
  recordAvailableCommands(
    sessionKey: string,
    commands: AcpRuntimeAvailableCommand[],
  ): void {
    this.lastCommands.set(sessionKey, commands)
    this.events.emit('availableCommands', { sessionKey, commands })
  }

  /**
   * Route a raw runtime event to `provider.events` the same way a
   * language-model turn does. Used by `runSlashCommand`, whose turn does
   * not pass through the language model's event translator.
   */
  private routeLiveEvent(event: AcpRuntimeEvent, sessionKey: string): void {
    if (event.type !== 'status') return
    if (event.tag === 'usage_update') {
      this.recordUsage({
        used: event.used,
        size: event.size,
        cost: event.cost,
        breakdown: event.breakdown,
        at: Date.now(),
        sessionKey,
      })
    } else if (
      event.tag === 'available_commands_update' &&
      event.availableCommands
    ) {
      this.recordAvailableCommands(sessionKey, event.availableCommands)
    } else if (event.tag === 'plan' && event.entries) {
      this.recordPlan(sessionKey, event.entries)
    }
  }

  /**
   * Send a one-shot prompt whose text is a slash command (e.g.
   * `"/compact"`). The active agent interprets the slash on its side;
   * ACP itself has no compact verb. Drains the event iterator and routes
   * any `usage_update` / `available_commands_update` events the command
   * fires to `provider.events` subscribers, so (for example) the
   * post-compaction usage snapshot reaches the caller.
   */
  async runSlashCommand(input: {
    name: string
    sessionKey?: string
    agent?: string
    timeoutMs?: number
    signal?: AbortSignal
  }): Promise<void> {
    const { handle, sessionKey } = await this.ensureHandle({
      sessionKey: input.sessionKey,
      agent: input.agent,
    })
    const turn = this.runtime.startTurn({
      handle,
      text: input.name,
      mode: 'prompt',
      requestId: this.generateId(),
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    })
    for await (const event of turn.events) {
      // Route the live signals the same way a doStream/doGenerate turn
      // does, so subscribers still see them on a slash-command-only turn.
      this.routeLiveEvent(event, sessionKey)
    }
    const result = await turn.result
    if (result.status === 'failed') {
      throw new Error(
        `slash command "${input.name}" failed: ${result.error.message}`,
      )
    }
  }

  /**
   * Convenience wrapper around `runSlashCommand` that resolves a
   * `/compact`-like command name from the agent's advertised list. The
   * agent must have emitted at least one `available_commands_update`
   * before this is called; that flows through during a `doStream` /
   * `doGenerate` turn, not after `prepare()` alone. Throws if no
   * compact-like command is advertised.
   */
  async compact(
    opts: { sessionKey?: string; agent?: string } = {},
  ): Promise<void> {
    const sessionKey = this.resolveSessionKey({
      sessionKey: opts.sessionKey,
      agent: opts.agent,
    })
    const cmds = this.lastCommands.get(sessionKey) ?? []
    const cmd = cmds.find((c) => {
      const stripped = c.name.replace(/^\//, '').toLowerCase()
      return stripped === 'compact' || stripped === 'condense'
    })
    if (!cmd) {
      throw new Error(
        `active agent does not advertise a compact command on session "${sessionKey}". ` +
          'Wait for an available_commands_update event (it flows during a doStream/doGenerate turn, not after prepare()/ensureHandle alone) before calling compact().',
      )
    }
    const name = cmd.name.startsWith('/') ? cmd.name : `/${cmd.name}`
    await this.runSlashCommand({
      name,
      sessionKey: opts.sessionKey,
      agent: opts.agent,
    })
  }

  async doctor(): Promise<AcpRuntimeDoctorReport> {
    const doctorImpl = this.runtime.doctor
    if (!doctorImpl) {
      return { ok: true, message: 'no doctor implementation in this runtime' }
    }
    return await doctorImpl.call(this.runtime)
  }

  private buildRuntimeOptions(): AcpRuntimeOptions {
    const stateDir = this.settings.stateDir ?? path.join(os.homedir(), '.acpx')
    return {
      cwd: this.settings.cwd ?? process.cwd(),
      sessionStore: createFileSessionStore({ stateDir }),
      agentRegistry: createAgentRegistry({
        overrides: this.settings.agentRegistryOverrides,
      }),
      permissionMode: (this.settings.permissionMode ??
        DEFAULT_PERMISSION_MODE) as AcpRuntimeOptions['permissionMode'],
      nonInteractivePermissions: (this.settings.nonInteractivePermissions ??
        DEFAULT_NON_INTERACTIVE) as AcpRuntimeOptions['nonInteractivePermissions'],
      timeoutMs: this.settings.turnTimeoutMs,
      mcpServers: this.resolveMcpServers(),
      onPermissionRequest: this.settings.onPermissionRequest,
      // Pass-through embedding controls. Each is omitted rather than set to
      // undefined when unset, because acpx treats an omitted option as
      // "inherit the default" and the defaults differ per option.
      ...(this.settings.agentProcessEnv
        ? { agentProcessEnv: this.settings.agentProcessEnv }
        : {}),
      ...(this.settings.agentProcessEnvAllow
        ? { agentProcessEnvAllow: this.settings.agentProcessEnvAllow }
        : {}),
      ...(this.settings.agentProcessEnvBlock
        ? { agentProcessEnvBlock: this.settings.agentProcessEnvBlock }
        : {}),
      ...(this.settings.fs !== undefined ? { fs: this.settings.fs } : {}),
      ...(this.settings.terminal !== undefined
        ? { terminal: this.settings.terminal }
        : {}),
      ...(this.settings.processLifecycle
        ? { processLifecycle: this.settings.processLifecycle }
        : {}),
      ...(this.settings.sessionPermissions
        ? { sessionPermissions: this.settings.sessionPermissions }
        : {}),
    }
  }
}

function defaultIdGen(): () => string {
  let n = 0
  return () => `acpx-${++n}`
}

export function createAcpxProvider(
  settings: AcpxProviderSettings,
): AcpxProvider {
  return new AcpxProvider(settings)
}
