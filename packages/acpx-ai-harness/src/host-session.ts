import { randomBytes } from 'node:crypto'
import type { HarnessV1Session, HarnessV1StartOptions } from '@ai-sdk/harness'
import { markBridgeStarting, waitForBridgeReady } from '@ai-sdk/harness/utils'
import type { AcpxHarnessSettings } from './acpx-harness.ts'
import { pickResumeCoords, tryAttachToExistingBridge } from './host-attach.ts'
import { createSession } from './host-create-session.ts'
import { pickPort, shellQuote, tailStderr } from './host-session-utils.ts'
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
        respawnStrategy: 'attach',
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

  // Drain stderr in the background. waitForBridgeReady reads stdout only,
  // so a bridge crash that prints to stderr (e.g. `Cannot find module`)
  // surfaces here.
  const stderr = tailStderr(proc)

  const formatTails = (stdoutTail: ReadonlyArray<string>) => {
    const stderrLines = stderr.read()
    const sections: string[] = []
    if (stdoutTail.length > 0)
      sections.push(`stdout tail:\n${stdoutTail.join('\n')}`)
    if (stderrLines.length > 0)
      sections.push(`stderr tail:\n${stderrLines.join('\n')}`)
    return sections.length > 0
      ? `\n${sections.join('\n\n')}`
      : '\n(no output captured)'
  }

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
      createExitError: ({ stdoutTail }) =>
        new Error(
          `acpx-ai-harness: bridge exited before becoming ready.${formatTails(stdoutTail)}`,
        ),
      createTimeoutError: ({ stdoutTail }) =>
        new Error(
          `acpx-ai-harness: bridge did not become ready before timeout.${formatTails(stdoutTail)}`,
        ),
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
    respawnStrategy: isResumeRequest ? 'rerun' : 'fresh',
  })
}
