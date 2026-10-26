import { type ChildProcessByStdio, spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
// The `/unstable` entrypoint, deliberately. A capability probe reports what
// an agent advertises, and the stable entrypoint's types omit
// `sessionCapabilities.fork`, `sessionCapabilities.systemPrompt`,
// `agentCapabilities.providers` and `mcpCapabilities.acp`. Both entrypoints
// pass those fields through at runtime, so this buys typed access to them
// rather than rescuing data: on stable they would still arrive and would
// still have to be reported, just through an untyped bag.
import {
  type ClientContext,
  client,
  type InitializeResponse,
  methods,
  type NewSessionResponse,
  ndJsonStream,
  RequestError,
} from '@agentclientprotocol/sdk/unstable'
import {
  deriveModelConfig,
  deriveReasoning,
  normalizeAgentInfo,
  normalizeAuthMethods,
  normalizeCapabilities,
  normalizeConfigOptions,
  normalizeModels,
  normalizeModes,
} from './_internal/normalize.ts'
import { resolveAgentCommandFromId, splitArgv } from './resolve-command.ts'
import type {
  AgentProbeRequest,
  AgentProbeResult,
  ProbeError,
  ProbeErrorCode,
} from './types.ts'

const DEFAULT_TIMEOUT_MS = 30_000
const STDERR_CAP_BYTES = 8 * 1024
const ACP_METHOD_NOT_FOUND = -32601

/**
 * Carries an already-classified `ProbeError` out of the `connectWith`
 * callback. `connectWith` owns the connection lifetime, so a handshake
 * failure cannot `return` past it the way the pre-2.x straight-line code
 * did; it throws this instead and the caller unwraps it.
 */
class ProbeFailure extends Error {
  override name = 'ProbeFailure'
  constructor(readonly probeError: ProbeError) {
    super(probeError.message)
  }
}

/** Which handshake request is in flight, for error classification. */
type HandshakePhase = 'initialize' | 'session_new' | 'teardown'

const PHASE_TIMEOUT_CODE: Record<HandshakePhase, ProbeErrorCode> = {
  initialize: 'initialize_timeout',
  session_new: 'session_new_timeout',
  // The teardown requests swallow their own rejections, so a timeout
  // reaching the classifier from here is not one of theirs.
  teardown: 'unknown',
}

const PHASE_DESCRIPTION: Record<HandshakePhase, string> = {
  initialize: 'before responding to initialize',
  session_new: 'during session/new',
  teardown: 'during session teardown',
}

/** What the handshake produced, before it is shaped into a result. */
type Handshake =
  | {
      kind: 'ok'
      initialize: InitializeResponse
      newSession: NewSessionResponse
      supportsConfigOption: boolean
    }
  | { kind: 'auth_required'; initialize: InitializeResponse }

/**
 * Probe an ACP-compatible agent for its capabilities. Performs an
 * `initialize` + `session/new` handshake (and optionally a no-op
 * `session/set_config_option` ping to detect `-32601`), then tears the
 * agent down. No real prompt is sent, so no LLM tokens are consumed.
 */
export async function probeAgent(
  request: AgentProbeRequest,
): Promise<AgentProbeResult> {
  const probedAt = new Date().toISOString()
  const startedNs = process.hrtime.bigint()
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const { agentId, argv } = await resolveArgv(request)
  const command = argv.join(' ')

  const baseResult = (): AgentProbeResult => ({
    agent: {
      id: agentId,
      command,
      argv,
      probedAt,
      durationMs: durationSince(startedNs),
    },
    protocolVersion: 0,
    agentInfo: null,
    capabilities: emptyCapabilities(),
    authMethods: [],
    models: [],
    modes: [],
    configOptions: [],
    reasoning: null,
    modelConfig: null,
    supportsConfigOption: false,
    raw: { initialize: null, newSession: null },
  })

  let child: ChildProcessByStdio<Writable, Readable, Readable> | null = null
  let stderrBuf = ''
  let initialize: InitializeResponse | null = null
  let newSession: NewSessionResponse | null = null

  const fail = (error: ProbeError): AgentProbeResult => ({
    ...baseResult(),
    agent: { ...baseResult().agent, durationMs: durationSince(startedNs) },
    error,
    raw: { initialize, newSession },
  })

  try {
    child = spawnAgent(argv, request)
  } catch (err) {
    return fail({
      code: 'spawn_failed',
      message: err instanceof Error ? err.message : String(err),
    })
  }
  child.stderr.on('data', (chunk: Buffer) => {
    if (stderrBuf.length < STDERR_CAP_BYTES) {
      stderrBuf += chunk.toString('utf8')
      if (stderrBuf.length > STDERR_CAP_BYTES) {
        stderrBuf = stderrBuf.slice(0, STDERR_CAP_BYTES)
      }
    }
  })

  // Capture spawn ENOENT / EACCES asynchronously (Node's spawn fails
  // its sync return but raises 'error' on the child later).
  const spawnError: { value: Error | null } = { value: null }
  child.once('error', (err) => {
    spawnError.value = err
  })

  // Track unexpected child death — surfaces as agent_crashed if it
  // happens before we've completed initialize/session/new AND wasn't
  // triggered by our own killChild() (in which case `killedByUs` is
  // set first).
  const childExited: {
    value: { code: number | null; signal: NodeJS.Signals | null } | null
  } = { value: null }
  const killedByUs = { value: false }
  child.once('exit', (code, signal) => {
    childExited.value = { code, signal }
  })

  const stream = ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
  )
  const app = client()
    .onRequest(methods.client.session.requestPermission, async () => {
      // The probe never sends a real session/prompt, so this branch
      // shouldn't fire. Deny defensively if an agent emits a request
      // out-of-band.
      return { outcome: { outcome: 'cancelled' as const } }
    })
    .onNotification(methods.client.session.update, async () => {
      // Probe is non-interactive; updates are ignored.
    })

  const timeBudget = new TimeBudget(timeoutMs)

  /**
   * Which request is in flight. Read by the outer catch to pick the right
   * timeout code and message.
   *
   * Classification cannot happen inside the `connectWith` callback.
   * `connectWith` rejects with its own "ACP connection closed" error the
   * moment the stream dies, which beats an inner handler that awaits
   * anything: the child's 'exit' event has not been observed yet at that
   * point, so an inner classifier sees no exit and reports `unknown`
   * instead of `agent_crashed`. The outer catch runs after the connection
   * has closed, where draining the event loop does surface the exit.
   */
  let phase: HandshakePhase = 'initialize'

  /**
   * Classify a handshake rejection. Lets pending 'error'/'exit' events
   * drain first: the SDK call can reject (closed stream / EPIPE) racily a
   * tick before the spawn 'error' or child 'exit' event fires.
   */
  const classifyHandshake = async (err: unknown): Promise<ProbeError> => {
    const timeoutCode = PHASE_TIMEOUT_CODE[phase]
    await drainPendingEvents()
    if (spawnError.value) {
      return {
        code: 'spawn_failed',
        message: spawnError.value.message,
        stderr: stderrBuf || undefined,
      }
    }
    if (err instanceof TimeoutError) {
      return {
        code: timeoutCode,
        message: err.message,
        stderr: stderrBuf || undefined,
      }
    }
    if (
      childExited.value &&
      !killedByUs.value &&
      childExited.value.code !== 0
    ) {
      return {
        code: 'agent_crashed',
        message: `Agent exited (code=${childExited.value.code ?? null}, signal=${childExited.value.signal ?? null}) ${PHASE_DESCRIPTION[phase]}`,
        stderr: stderrBuf || undefined,
      }
    }
    return classifyError(err, 'unknown', stderrBuf)
  }

  let handshake: Handshake
  try {
    handshake = await app.connectWith(
      stream,
      async (ctx: ClientContext): Promise<Handshake> => {
        // --- initialize ---
        phase = 'initialize'
        initialize = await withDeadline(
          ctx.request(methods.agent.initialize, {
            protocolVersion: 1,
            clientCapabilities: {
              fs: { readTextFile: true, writeTextFile: true },
              terminal: false,
            },
            clientInfo: { name: 'acp-probe', version: '0.0.1' },
          }),
          timeBudget.remaining(),
        )

        if (initialize.protocolVersion !== 1) {
          throw new ProbeFailure({
            code: 'protocol_mismatch',
            message: `Agent advertised protocol version ${initialize.protocolVersion}; this probe supports 1.`,
            stderr: stderrBuf || undefined,
          })
        }

        // --- session/new ---
        const authMethods = normalizeAuthMethods(initialize)
        if (authMethods.length > 0 && request.authPolicy === 'fail') {
          return { kind: 'auth_required', initialize }
        }

        phase = 'session_new'
        newSession = await withDeadline(
          ctx.request(methods.agent.session.new, {
            cwd: request.cwd ?? process.cwd(),
            mcpServers: [],
          }),
          timeBudget.remaining(),
        )

        // --- supportsConfigOption ping ---
        phase = 'teardown'
        const supportsConfigOption = await pingConfigOption(
          ctx,
          newSession,
          timeBudget,
        )

        // --- tear down the session (best effort) ---
        await closeSession(ctx, newSession.sessionId, initialize)

        return {
          kind: 'ok',
          initialize,
          newSession,
          supportsConfigOption,
        }
      },
    )
  } catch (err) {
    // Classify BEFORE killing. `killChild` sets `killedByUs`, and the
    // `agent_crashed` branch is gated on that flag being unset, so killing
    // first turns every crash into `unknown`.
    const probeError =
      err instanceof ProbeFailure
        ? err.probeError
        : await classifyHandshake(err)
    await killChild(child, killedByUs)
    return fail(probeError)
  }

  await killChild(child, killedByUs)

  if (handshake.kind === 'auth_required') {
    const authMethods = normalizeAuthMethods(handshake.initialize)
    return {
      ...baseResult(),
      agent: { ...baseResult().agent, durationMs: durationSince(startedNs) },
      protocolVersion: handshake.initialize.protocolVersion,
      agentInfo: normalizeAgentInfo(handshake.initialize),
      capabilities: normalizeCapabilities(handshake.initialize),
      authMethods,
      error: {
        code: 'auth_required',
        message: `Agent advertised authMethods (${authMethods.length}) and authPolicy is 'fail'.`,
      },
      raw: { initialize: handshake.initialize, newSession: null },
    }
  }

  const configOptions = normalizeConfigOptions(handshake.newSession)
  const capabilities = normalizeCapabilities(handshake.initialize)
  const models = normalizeModels(configOptions)
  const modes = normalizeModes(handshake.newSession)
  const reasoning = deriveReasoning(configOptions)
  const modelConfig = deriveModelConfig(configOptions)

  return {
    agent: {
      id: agentId,
      command,
      argv,
      probedAt,
      durationMs: durationSince(startedNs),
    },
    protocolVersion: handshake.initialize.protocolVersion,
    agentInfo: normalizeAgentInfo(handshake.initialize),
    capabilities,
    authMethods: normalizeAuthMethods(handshake.initialize),
    models,
    modes,
    configOptions,
    reasoning,
    modelConfig,
    supportsConfigOption: handshake.supportsConfigOption,
    raw: {
      initialize: handshake.initialize,
      newSession: handshake.newSession,
    },
  }
}

/**
 * Probe whether `session/set_config_option` is wired up, by setting the
 * first select option back to the value it already holds. Any rejection
 * counts as unsupported: a probe must not fail over an optional method.
 */
async function pingConfigOption(
  ctx: ClientContext,
  newSession: NewSessionResponse,
  timeBudget: TimeBudget,
): Promise<boolean> {
  const configOptions = normalizeConfigOptions(newSession)
  if (configOptions.length === 0) return false
  const first = configOptions[0]
  if (first?.type !== 'select') return false
  if (typeof first.currentValue !== 'string') return false
  try {
    await withDeadline(
      ctx.request(methods.agent.session.setConfigOption, {
        sessionId: newSession.sessionId,
        configId: first.id,
        value: first.currentValue,
      }),
      Math.min(5_000, timeBudget.remaining()),
    )
    return true
  } catch (err) {
    // `-32601 method not found` is the expected "unsupported" answer
    // (gemini). Everything else is treated as unsupported too, rather
    // than failing the whole probe over an optional method.
    void (err instanceof RequestError && err.code === ACP_METHOD_NOT_FOUND)
    return false
  }
}

async function resolveArgv(
  request: AgentProbeRequest,
): Promise<{ agentId: string | null; argv: string[] }> {
  if (request.argv && request.argv.length > 0) {
    return { agentId: null, argv: [...request.argv] }
  }
  if (request.command) {
    return { agentId: null, argv: splitArgv(request.command) }
  }
  if (request.agent) {
    const argv = await resolveAgentCommandFromId(request.agent)
    return { agentId: request.agent, argv }
  }
  throw new Error(
    'probeAgent: provide exactly one of { agent }, { command }, or { argv }.',
  )
}

function spawnAgent(
  argv: string[],
  request: AgentProbeRequest,
): ChildProcessByStdio<Writable, Readable, Readable> {
  const [command, ...args] = argv
  if (!command) {
    throw new Error('probeAgent: empty argv after resolution.')
  }
  return spawn(command, args, {
    cwd: request.cwd ?? process.cwd(),
    env: { ...process.env, ...(request.env ?? {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

async function killChild(
  child: ChildProcessByStdio<Writable, Readable, Readable>,
  killedByUs: { value: boolean },
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  killedByUs.value = true
  child.kill('SIGTERM')
  // Best-effort 1s grace, then SIGKILL.
  await new Promise<void>((resolve) => {
    const onExit = (): void => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      try {
        child.kill('SIGKILL')
      } catch {
        /* already dead */
      }
      resolve()
    }, 1_000)
    child.once('exit', onExit)
  })
}

async function closeSession(
  ctx: ClientContext,
  sessionId: string,
  initialize: InitializeResponse,
): Promise<void> {
  if (!initialize.agentCapabilities?.sessionCapabilities?.close) return
  try {
    await withDeadline(
      ctx.request(methods.agent.session.close, { sessionId }),
      3_000,
    )
  } catch {
    // Best-effort close. We're about to kill the process anyway.
  }
}

class TimeBudget {
  private readonly deadline: number
  constructor(totalMs: number) {
    this.deadline = Date.now() + totalMs
  }
  remaining(): number {
    return Math.max(0, this.deadline - Date.now())
  }
}

async function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) {
    return Promise.race([
      p,
      Promise.reject(new TimeoutError(`deadline (${ms}ms) already elapsed`)),
    ]) as Promise<T>
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new TimeoutError(`deadline (${ms}ms) exceeded`)),
          ms,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

class TimeoutError extends Error {
  override name = 'TimeoutError'
}

/**
 * Yield to the event loop a handful of times so any pending
 * 'error'/'exit' notifications on the child process can be observed.
 * The SDK call can reject (closed stream / EPIPE) racily a tick before
 * Node emits the corresponding child event.
 */
async function drainPendingEvents(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

function classifyError(
  err: unknown,
  timeoutCode: ProbeErrorCode,
  stderr: string,
): ProbeError {
  if (err instanceof TimeoutError) {
    return {
      code: timeoutCode,
      message: err.message,
      stderr: stderr || undefined,
    }
  }
  if (err instanceof RequestError) {
    return {
      code: 'unknown',
      message: err.message,
      stderr: stderr || undefined,
      acpError: {
        code: err.code,
        message: err.message,
        data: err.data ?? undefined,
      },
    }
  }
  return {
    code: 'unknown',
    message: err instanceof Error ? err.message : String(err),
    stderr: stderr || undefined,
  }
}

function durationSince(startNs: bigint): number {
  return Number((process.hrtime.bigint() - startNs) / 1_000_000n)
}

function emptyCapabilities(): AgentProbeResult['capabilities'] {
  return {
    loadSession: false,
    promptCapabilities: { image: false, audio: false, embeddedContext: false },
    mcpCapabilities: { http: false, sse: false, acp: false },
    sessionCapabilities: {
      close: false,
      list: false,
      resume: false,
      fork: false,
      systemPrompt: false,
      additionalDirectories: false,
    },
  }
}
