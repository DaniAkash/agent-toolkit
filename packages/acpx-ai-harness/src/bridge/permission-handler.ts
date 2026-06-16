import type { BridgeTurn } from '@ai-sdk/harness/bridge'
import type { AcpPermissionDecision, AcpPermissionRequest } from 'acpx/runtime'

/**
 * Build an acpx `onPermissionRequest` callback that surfaces the request as a
 * harness `tool-approval-request` event and waits for the host to respond via
 * `submitToolApproval`.
 *
 * The harness consumer sees:
 *   1. `tool-approval-request` { approvalId, toolCallId } for the agent's
 *      pending tool call.
 *   2. (host inspects, calls `submitToolApproval({ approved, reason? })`.)
 *   3. acpx then either continues (approved) or short-circuits the tool
 *      (rejected). When the tool runs to completion, the translator's normal
 *      `tool-call` / `tool-result` emission path covers the rest.
 *
 * Returns `undefined` when the bridge turn was aborted while waiting — acpx
 * treats `undefined` as "fall through to the configured permissionMode."
 */
export function createPermissionHandler(turn: BridgeTurn) {
  return async (
    req: AcpPermissionRequest,
    ctx: { signal: AbortSignal },
  ): Promise<AcpPermissionDecision | undefined> => {
    const toolCallId = req.raw.toolCall.toolCallId
    const approvalId = toolCallId

    turn.emit({
      type: 'tool-approval-request',
      approvalId,
      toolCallId,
    })

    try {
      const decision = await Promise.race([
        turn.requestToolApproval(approvalId),
        new Promise<never>((_, reject) => {
          const onAbort = () => reject(new Error('aborted'))
          if (ctx.signal.aborted) onAbort()
          else ctx.signal.addEventListener('abort', onAbort, { once: true })
        }),
      ])
      return decision.approved
        ? { outcome: 'allow_once' }
        : { outcome: 'reject_once' }
    } catch {
      return undefined
    }
  }
}
