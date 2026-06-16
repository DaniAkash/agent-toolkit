import type {
  HarnessV1ContinueTurnState,
  HarnessV1NetworkSandboxSession,
  HarnessV1ResumeSessionState,
  HarnessV1StartOptions,
} from '@ai-sdk/harness'
import {
  type AcpxBridgeCoords,
  acpxBridgeCoordsSchema,
} from './acpx-lifecycle.ts'
import { type AcpxChannel, createAcpxChannel } from './sandbox-channel.ts'

export interface AttachAttempt {
  /** Open channel reconnected to the live bridge. */
  readonly channel: AcpxChannel
  /** Bridge coords that should populate future lifecycle-state emissions. */
  readonly coords: AcpxBridgeCoords
}

/**
 * Decode the bridge coords (if any) from a `resumeFrom` / `continueFrom`
 * payload. Returns `undefined` when the payload is absent, mis-typed, or
 * doesn't carry a `bridge` block.
 */
export function decodeBridgeCoords(
  state: HarnessV1ResumeSessionState | HarnessV1ContinueTurnState | undefined,
): AcpxBridgeCoords | undefined {
  if (!state) return undefined
  const data = state.data
  if (!data || typeof data !== 'object') return undefined
  const bridge = (data as { bridge?: unknown }).bridge
  if (!bridge) return undefined
  const parsed = acpxBridgeCoordsSchema.safeParse(bridge)
  return parsed.success ? parsed.data : undefined
}

/**
 * Pick the bridge coords from either resumeFrom or continueFrom, preferring
 * continueFrom (mid-turn) when both are present.
 */
export function pickResumeCoords(
  start: HarnessV1StartOptions,
): AcpxBridgeCoords | undefined {
  return (
    decodeBridgeCoords(start.continueFrom) ??
    decodeBridgeCoords(start.resumeFrom)
  )
}

/**
 * Try the ATTACH rung: reconnect to a live bridge using saved coords, seed
 * the channel's resume cursor with `lastSeenEventId`, and ask the bridge to
 * replay buffered events from there. Returns the open channel on success.
 *
 * Resolves to `undefined` when the saved coords don't match the current
 * sandbox (id changed) or when the connection attempt throws — both signal
 * the caller to fall through to a fresh spawn (RERUN).
 */
export async function tryAttachToExistingBridge(input: {
  sandboxSession: HarnessV1NetworkSandboxSession
  coords: AcpxBridgeCoords
}): Promise<AttachAttempt | undefined> {
  if (
    input.coords.sandboxId &&
    input.coords.sandboxId !== input.sandboxSession.id
  ) {
    return undefined
  }
  const channel = createAcpxChannel({
    sandboxSession: input.sandboxSession,
    port: input.coords.port,
    token: input.coords.token,
    initialLastSeenEventId: input.coords.lastSeenEventId,
  })
  try {
    await channel.open({ resume: true })
  } catch {
    try {
      channel.close()
    } catch {
      /* idempotent */
    }
    return undefined
  }
  return { channel, coords: input.coords }
}
