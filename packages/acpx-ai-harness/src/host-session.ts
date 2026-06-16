import { randomBytes } from 'node:crypto'
import type {
  HarnessV1ContinueTurnState,
  HarnessV1PromptControl,
  HarnessV1PromptTurnOptions,
  HarnessV1ResumeSessionState,
  HarnessV1Session,
  HarnessV1StartOptions,
} from '@ai-sdk/harness'
import { HarnessCapabilityUnsupportedError } from '@ai-sdk/harness'
import { markBridgeStarting, waitForBridgeReady } from '@ai-sdk/harness/utils'
import type { Experimental_SandboxProcess } from '@ai-sdk/provider-utils'
import type { AcpxBridgeStartMessage } from './acpx-bridge-protocol.ts'
import type { AcpxHarnessSettings } from './acpx-harness.ts'
import { requestDetachPayload } from './host-detach.ts'
import { wirePromptControl } from './host-prompt-control.ts'
import {
  extractPromptText,
  pickPort,
  shellQuote,
} from './host-session-utils.ts'
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
      `--workdir ${shellQuote(start.sessionWorkDir)} ` +
      `--bridge-state-dir ${shellQuote(bridgeStateDir)}`,
    env: {
      BRIDGE_CHANNEL_TOKEN: token,
      BRIDGE_WS_PORT: String(port),
    },
    abortSignal: start.abortSignal,
  })

  // From this point on, anything that throws must tear the bridge process
  // down or it leaks inside the sandbox. waitForBridgeReady() can time out;
  // channel.open() can fail if the WS port never becomes reachable.
  let channel: AcpxChannel | undefined
  try {
    await waitForBridgeReady({
      proc,
      sandbox: sandboxSession.restricted(),
      bridgeStateDir,
      bridgeType: 'acpx',
      timeoutMs: settings.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
      abortSignal: start.abortSignal,
    })

    channel = createAcpxChannel({ sandboxSession, port, token })
    await channel.open()
  } catch (err) {
    try {
      channel?.close()
    } catch {
      /* idempotent */
    }
    try {
      await proc.kill()
    } catch {
      /* idempotent */
    }
    throw err
  }

  return createSession({
    sessionId: start.sessionId,
    sessionWorkDir: start.sessionWorkDir,
    settings,
    agent,
    channel,
    proc,
    bridgeCoords: { port, token, sandboxId: sandboxSession.id },
  })
}

interface BridgeCoordsLite {
  readonly port: number
  readonly token: string
  readonly sandboxId: string
}

interface CreateSessionInput {
  readonly sessionId: string
  readonly sessionWorkDir: string
  readonly settings: AcpxHarnessSettings
  readonly agent: string
  readonly channel: AcpxChannel
  readonly proc: Experimental_SandboxProcess
  readonly bridgeCoords: BridgeCoordsLite
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
    const trimmedInstructions = opts.instructions?.trim() ?? ''
    const shouldApply = !instructionsApplied && trimmedInstructions.length > 0
    const text = shouldApply ? `${trimmedInstructions}\n\n${prompt}` : prompt
    if (shouldApply) instructionsApplied = true

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

  const buildBridgeState = (lastSeenEventId: number) => ({
    bridge: {
      port: input.bridgeCoords.port,
      token: input.bridgeCoords.token,
      sandboxId: input.bridgeCoords.sandboxId,
      lastSeenEventId,
    },
  })

  const doSuspendTurn = async (): Promise<HarnessV1ContinueTurnState> => {
    assertLive('doSuspendTurn')
    stopped = true
    const lastSeenEventId = await input.channel.suspend()
    return {
      type: 'continue-turn',
      harnessId: 'acpx',
      specificationVersion: 'harness-v1',
      data: buildBridgeState(lastSeenEventId),
    }
  }

  const doDetach = async (): Promise<HarnessV1ResumeSessionState> => {
    assertLive('doDetach')
    stopped = true
    const lastSeenEventId = await input.channel.suspend()
    return {
      type: 'resume-session',
      harnessId: 'acpx',
      specificationVersion: 'harness-v1',
      data: buildBridgeState(lastSeenEventId),
    }
  }

  const doStop = async (): Promise<HarnessV1ResumeSessionState> => {
    assertLive('doStop')
    stopped = true
    input.channel.beginClose()
    const detachData = await requestDetachPayload(input.channel)
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
    return {
      type: 'resume-session',
      harnessId: 'acpx',
      specificationVersion: 'harness-v1',
      data: detachData as HarnessV1ResumeSessionState['data'],
    }
  }

  return {
    sessionId: input.sessionId,
    isResume: false,
    doPromptTurn,
    doContinueTurn: async () => {
      throw new HarnessCapabilityUnsupportedError({
        harnessId: 'acpx',
        message:
          'acpx-ai-harness: doContinueTurn() lands in a follow-up release.',
      })
    },
    doSuspendTurn,
    doDetach,
    doStop,
    doDestroy,
    doCompact: async () => {
      throw new HarnessCapabilityUnsupportedError({
        harnessId: 'acpx',
        message:
          'acpx-ai-harness: doCompact() is not supported. acpx runtimes auto-compact internally; manual compaction has no API.',
      })
    },
  }
}
