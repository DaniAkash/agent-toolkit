import { harnessV1BridgeStartBaseSchema } from '@ai-sdk/harness'
import { z } from 'zod/v4'

/**
 * MCP server descriptor the bridge accepts on a `start` message. Mirrors
 * acpx's `AcpxMcpServerConfig` shape so the host can forward consumer-supplied
 * MCP servers verbatim to the agent running inside the sandbox.
 */
export const acpxBridgeMcpServerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('stdio'),
    name: z.string(),
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    type: z.literal('http'),
    name: z.string(),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    type: z.literal('sse'),
    name: z.string(),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
])

export type AcpxBridgeMcpServer = z.infer<typeof acpxBridgeMcpServerSchema>

/**
 * Extension of the harness `start` frame with acpx-specific fields the bridge
 * needs to instantiate a session: which ACP agent to spawn, where to keep
 * state, which model to use, any extra MCP servers, and whether this is a
 * rerun-style continuation.
 */
export const acpxBridgeStartMessageSchema =
  harnessV1BridgeStartBaseSchema.extend({
    agent: z.string(),
    sessionKey: z.string(),
    cwd: z.string(),
    model: z.string().optional(),
    stateDir: z.string().optional(),
    mcpServers: z.array(acpxBridgeMcpServerSchema).optional(),
    continue: z.boolean().optional(),
  })

export type AcpxBridgeStartMessage = z.infer<
  typeof acpxBridgeStartMessageSchema
>
