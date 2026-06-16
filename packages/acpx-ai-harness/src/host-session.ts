import { randomBytes } from 'node:crypto'
import type {
  HarnessV1NetworkSandboxSession,
  HarnessV1Prompt,
  HarnessV1PromptControl,
  HarnessV1PromptTurnOptions,
  HarnessV1Session,
  HarnessV1StartOptions,
} from '@ai-sdk/harness'
import { HarnessCapabilityUnsupportedError } from '@ai-sdk/harness'
import { markBridgeStarting, waitForBridgeReady } from '@ai-sdk/harness/utils'
import type { Experimental_SandboxProcess } from '@ai-sdk/provider-utils'
import type { AcpxBridgeStartMessage } from './acpx-bridge-protocol.ts'
import type { AcpxHarnessSettings } from './acpx-harness.ts'
import { wirePromptControl } from './host-prompt-control.ts'
import { type AcpxChannel, createAcpxChannel } from './sandbox-channel.ts'

const BRIDGE_BUNDLE_PATH = '/tmp/harness/acpx/bridge.mjs'
const DEFAULT_STARTUP_TIMEOUT_MS = 120_000

export async function doStartImpl(
  settings: AcpxHarnessSettings,
  start: HarnessV1StartOptions,
): Promise<HarnessV1Session> {
  if (start.resumeFrom || start.continueFrom) {
    throw new HarnessCapabilityUnsupportedError({
      harnessId: 'acpx',
      message:
        'acpx-ai-harness: resume and continue paths are not implemented yet. ' +
        'Only fresh `doStart()` is supported in this release.',
    })
  }

  const sandboxSession = start.sandboxSession
  const port = pickPort(sandboxSession, settings.port)
  const token = randomBytes(32).toString('hex')
  const bridgeStateDir = `${start.sessionWorkDir}/.bridge-state`
  const agent = settings.agent ?? 'codex'

  await markBridgeStarting({
    sandbox: sandboxSession.restricted(),
    bridgeStateDir,
    bridgeType: 'acpx',
    abortSignal: start.abortSignal,
  })

  const proc = await sandboxSession.restricted().spawn({
    command:
      `node ${BRIDGE_BUNDLE_PATH} ` +
      `--workdir ${quote(start.sessionWorkDir)} ` +
      `--bridge-state-dir ${quote(bridgeStateDir)}`,
    env: {
      BRIDGE_CHANNEL_TOKEN: token,
      BRIDGE_WS_PORT: String(port),
    },
    abortSignal: start.abortSignal,
  })

  await waitForBridgeReady({
    proc,
    sandbox: sandboxSession.restricted(),
    bridgeStateDir,
    bridgeType: 'acpx',
    timeoutMs: settings.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
    abortSignal: start.abortSignal,
  })

  const channel = createAcpxChannel({ sandboxSession, port, token })
  await channel.open()

  return createSession({
    sessionId: start.sessionId,
    sessionWorkDir: start.sessionWorkDir,
    settings,
    agent,
    channel,
    proc,
  })
}

interface CreateSessionInput {
  readonly sessionId: string
  readonly sessionWorkDir: string
  readonly settings: AcpxHarnessSettings
  readonly agent: string
  readonly channel: AcpxChannel
  readonly proc: Experimental_SandboxProcess
}

function createSession(input: CreateSessionInput): HarnessV1Session {
  let stopped = false
  let instructionsApplied = false

  const assertLive = (method: string) => {
    if (stopped) {
      throw new Error(
        `acpx-ai-harness session ${input.sessionId} is already stopped; cannot call ${method}.`,
      )
    }
  }

  const doPromptTurn = (
    opts: HarnessV1PromptTurnOptions,
  ): Promise<HarnessV1PromptControl> => {
    assertLive('doPromptTurn')
    const prompt = extractPromptText(opts.prompt)
    const text =
      !instructionsApplied && opts.instructions
        ? `${opts.instructions.trim()}\n\n${prompt}`
        : prompt
    instructionsApplied = true

    const frame: AcpxBridgeStartMessage = {
      type: 'start',
      prompt: text,
      agent: input.agent,
      sessionKey: input.sessionId,
      cwd: input.sessionWorkDir,
      ...(input.settings.model ? { model: input.settings.model } : {}),
      ...(input.settings.stateDir ? { stateDir: input.settings.stateDir } : {}),
      ...(opts.tools && opts.tools.length > 0
        ? { tools: opts.tools.map((t) => ({ ...t })) }
        : {}),
    }

    const control = wirePromptControl({
      channel: input.channel,
      emit: opts.emit,
      abortSignal: opts.abortSignal,
    })

    input.channel.send(frame)
    return Promise.resolve(control)
  }

  const doDestroy = async (): Promise<void> => {
    if (stopped) return
    stopped = true
    try {
      input.channel.beginClose()
      input.channel.send({ type: 'shutdown' })
    } catch {
      /* socket may already be gone */
    }
    try {
      await Promise.race([
        input.proc.wait(),
        new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
      ])
    } finally {
      try {
        await input.proc.kill()
      } catch {
        /* idempotent */
      }
      input.channel.close()
    }
  }

  const notImplemented = (method: string) => () => {
    throw new HarnessCapabilityUnsupportedError({
      harnessId: 'acpx',
      message: `acpx-ai-harness: ${method}() lands in a follow-up release.`,
    })
  }

  return {
    sessionId: input.sessionId,
    isResume: false,
    doPromptTurn,
    doContinueTurn: notImplemented('doContinueTurn'),
    doSuspendTurn: notImplemented('doSuspendTurn'),
    doDetach: notImplemented('doDetach'),
    doStop: notImplemented('doStop'),
    doDestroy,
    doCompact: () => {
      throw new HarnessCapabilityUnsupportedError({
        harnessId: 'acpx',
        message:
          'acpx-ai-harness: doCompact() is not supported. acpx runtimes auto-compact internally; manual compaction has no API.',
      })
    },
  }
}

function pickPort(
  sandboxSession: HarnessV1NetworkSandboxSession,
  override: number | undefined,
): number {
  if (override !== undefined) return override
  const first = sandboxSession.ports[0]
  if (first === undefined) {
    throw new Error(
      'acpx-ai-harness: the sandbox session exposes no ports; cannot launch the bridge.',
    )
  }
  return first
}

function quote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

function extractPromptText(prompt: HarnessV1Prompt): string {
  if (typeof prompt === 'string') return prompt
  const content = prompt.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((p) => p.type === 'text')
      .map((p) => (p as { text: string }).text)
      .join('')
  }
  return ''
}
