import { z } from 'zod'

/**
 * Bridge coordinates for reattaching to a live runtime. Persisted by the
 * harness as part of `HarnessV1ResumeSessionState` / `HarnessV1ContinueTurnState`
 * so a fresh process can find the same WebSocket bridge and resume from a
 * known event cursor.
 */
export const acpxBridgeCoordsSchema = z.object({
  port: z.number(),
  token: z.string(),
  lastSeenEventId: z.number(),
  sandboxId: z.string().optional(),
})

export type AcpxBridgeCoords = z.infer<typeof acpxBridgeCoordsSchema>

/**
 * Adapter-defined `data` payload for `HarnessV1LifecycleStateBase`.
 *
 * `bridge` is set when the runtime is parked and reachable over WebSocket.
 * `sessionKey` is the acpx-side identifier used to find session state on
 * disk after the runtime has been fully stopped.
 */
export const acpxLifecycleStateSchema = z
  .object({
    bridge: acpxBridgeCoordsSchema.optional(),
    sessionKey: z.string().optional(),
  })
  .passthrough()

export type AcpxLifecycleState = z.infer<typeof acpxLifecycleStateSchema>
