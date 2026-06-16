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
import { pickResumeCoords, tryAttachToExistingBridge } from './host-attach.ts'
import { requestDetachPayload } from './host-detach.ts'
import { wirePromptControl } from './host-prompt-control.ts'
import {
  awaitProcExit,
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
  const sandboxSession = start.sandboxSession
  const agent = settings.agent ?? 'codex'
  const isResumeRequest = Boolean(start.resumeFrom || start.continueFrom)

  // Rung 1: ATTACH to a live bridge if the caller passed coords pointing at
  // one. Failures (sandbox changed, WS unreachable) silently fall through
  // to a fresh spawn.
  const resumeCoords = pickResumeCoords(start)
  if (resumeCoords) {
    const attached = await tryAttachToExistingBridge({
      sandboxSession,
      coords: resumeCoords,
    })
    if (attached) {
      return createSession({
        sessionId: start.sessionId,
        sessionWorkDir: start.sessionWorkDir,
        settings,
        agent,
        channel: attached.channel,
        proc: undefined,
        bridgeCoords: {
          port: attached.coords.port,
          token: attached.coords.token,
          sandboxId: attached.coords.sandboxId ?? sandboxSession.id,
        },
        isResume: true,
      })
    }
  }

  // Rung 2: RERUN. Spawn a fresh bridge; acpx will reload the persisted
  // session from disk via sessionKey on the first turn.
  const port = pickPort(sandboxSession, settings.port)
  const token = randomBytes(32).toString('hex')
  const bridgeStateDir = `${start.sessionWorkDir}/.bridge-state`

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
    isResume: isResumeRequest,
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
  /**
   * Bridge process handle, or undefined when we ATTACH'd to a bridge
   * spawned by a previous process. On ATTACH the host doesn't own the
   * process lifecycle, so doDestroy / doStop send `shutdown` / `detach`
   * frames and trust the bridge to exit.
   */
  readonly proc: Experimental_SandboxProcess | undefined
  readonly bridgeCoords: BridgeCoordsLite
  readonly isResume: boolean
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
    await awaitProcExit(input.proc)
    input.channel.close()
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
    await awaitProcExit(input.proc)
    input.channel.close()
    return {
      type: 'resume-session',
      harnessId: 'acpx',
      specificationVersion: 'harness-v1',
      data: detachData as HarnessV1ResumeSessionState['data'],
    }
  }

  return {
    sessionId: input.sessionId,
    isResume: input.isResume,
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
