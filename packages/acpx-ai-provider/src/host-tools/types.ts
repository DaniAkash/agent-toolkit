/**
 * Host tools: functions in the embedding application that the agent can
 * call mid-turn, served to it as an MCP server.
 *
 * These are declared on the provider rather than read off
 * `callOptions.tools`, because `LanguageModelV2FunctionTool` carries only
 * `{ type, name, description, inputSchema }`. The AI SDK keeps `execute`
 * on its own side and never hands it to a provider, so a provider cannot
 * answer an out-of-band call from the tool set alone. See the note in
 * README under "Host tools".
 */

/** A JSON Schema object describing one tool's arguments. */
export interface AcpxHostToolSchema {
  type: 'object'
  properties?: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
  [key: string]: unknown
}

export interface AcpxHostToolContext {
  /**
   * Aborted when the turn is cancelled. A long-running tool (one that waits
   * on a human) should listen to this and clean up, since cancelling the
   * turn is the only thing that will interrupt it.
   */
  abortSignal: AbortSignal
  /** The provider session key this call arrived on. */
  sessionKey: string
  /** The agent's own id for this tool call, for correlation with the stream. */
  toolCallId: string
}

export interface AcpxHostTool {
  /**
   * What the tool does, in the words the model will read.
   *
   * This is not decoration. On an agent that cannot be given a system
   * prompt (codex advertises `sessionCapabilities.systemPrompt: false`),
   * the description is the only channel that reliably reaches the model.
   */
  description: string
  inputSchema: AcpxHostToolSchema
  execute: (
    input: Record<string, unknown>,
    context: AcpxHostToolContext,
  ) => unknown | Promise<unknown>
  /**
   * Response deadline for this tool, not an execution bound. When it
   * elapses the agent is answered with an error, but `execute` keeps
   * running: a promise cannot be cancelled from outside. To be genuinely
   * interruptible, honour `context.abortSignal`.
   *
   * Unset means none, which is the default: a tool that blocks on a human
   * answer is not wedged, and the turn's abort signal is what bounds it.
   */
  timeoutMs?: number
}

export interface AcpxHostToolsSettings {
  tools: Record<string, AcpxHostTool>
  /**
   * MCP server name the agent sees. Each agent namespaces differently
   * (`mcp__host__say`, `host__say`, the bare name), which is why consumers
   * should match on `providerMetadata.acpx.hostTool` rather than on the
   * name.
   */
  serverName?: string
  /**
   * Bind address. Loopback by default; nothing about this server is meant
   * to be reachable off-box.
   */
  hostname?: string
}

/** What a `tools/call` turned into, for the language model to annotate. */
export interface HostToolCallRecord {
  toolName: string
  toolCallId: string
}
