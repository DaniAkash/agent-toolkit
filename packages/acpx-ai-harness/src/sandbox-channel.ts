import type {
  HarnessV1BridgeOutboundMessage,
  HarnessV1NetworkSandboxSession,
} from '@ai-sdk/harness'
import { harnessV1BridgeOutboundMessageSchema } from '@ai-sdk/harness'
import { SandboxChannel } from '@ai-sdk/harness/utils'
import { WebSocket } from 'ws'
import type { AcpxBridgeStartMessage } from './acpx-bridge-protocol.ts'

/**
 * Inbound (host -> bridge) message union for acpx. Mirrors the reference
 * adapter pattern: an adapter-specific `start` extension plus the standard
 * harness inbound control frames the bridge knows how to parse.
 */
export type AcpxBridgeInboundMessage =
  | AcpxBridgeStartMessage
  | {
      type: 'tool-result'
      toolCallId: string
      output: unknown
      isError?: boolean
    }
  | {
      type: 'tool-approval-response'
      approvalId: string
      approved: boolean
      reason?: string
    }
  | { type: 'user-message'; text: string }
  | { type: 'abort' }
  | { type: 'shutdown' }
  | { type: 'detach' }
  | { type: 'resume'; lastSeenEventId: number }

/** Channel typed against the acpx outbound + inbound wire shapes. */
export type AcpxChannel = SandboxChannel<
  HarnessV1BridgeOutboundMessage,
  AcpxBridgeInboundMessage
>

export interface OpenAcpxChannelOptions {
  readonly sandboxSession: HarnessV1NetworkSandboxSession
  readonly port: number
  /** Per-bridge auth token; appended to the URL as `agent_bridge_token`. */
  readonly token: string
  /** When set, seeds the resume cursor for cross-process attach. */
  readonly initialLastSeenEventId?: number
}

/**
 * Build (but don't yet open) a SandboxChannel pointed at the in-sandbox
 * bridge's WebSocket endpoint. The caller decides whether to open fresh
 * (`channel.open()`) or resume against a buffered log
 * (`channel.open({ resume: true })`).
 *
 * The connect thunk re-resolves the URL on every reconnect so transient
 * sandbox-side port re-binds are tolerated by the channel's auto-reconnect
 * loop.
 */
export function createAcpxChannel(opts: OpenAcpxChannelOptions): AcpxChannel {
  const connect = async (): Promise<WebSocket> => {
    const base = await opts.sandboxSession.getPortUrl({
      port: opts.port,
      protocol: 'ws',
    })
    const url = `${base}?agent_bridge_token=${encodeURIComponent(opts.token)}`
    return new WebSocket(url)
  }

  return new SandboxChannel<
    HarnessV1BridgeOutboundMessage,
    AcpxBridgeInboundMessage
  >({
    connect,
    outboundSchema: harnessV1BridgeOutboundMessageSchema,
    ...(opts.initialLastSeenEventId !== undefined
      ? { initialLastSeenEventId: opts.initialLastSeenEventId }
      : {}),
  })
}
