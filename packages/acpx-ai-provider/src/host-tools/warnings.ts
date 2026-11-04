/**
 * Warnings for the gap between what the caller asked for and what the
 * provider can serve.
 *
 * `streamText({ tools })` hands a provider only `{ name, description,
 * inputSchema }`; the AI SDK keeps `execute` and never passes it down. So
 * a tool present in `callOptions.tools` with no matching entry in
 * `hostTools` cannot be answered out of band, and the caller is told
 * rather than left to infer it from a tool that never fires.
 */
import type {
  LanguageModelV2CallOptions,
  LanguageModelV2CallWarning,
} from '@ai-sdk/provider'

export interface HostToolWarningInput {
  tools: LanguageModelV2CallOptions['tools']
  /** Names declared under `hostTools.tools`. */
  declared: string[]
  /**
   * True when the session was already live, so its MCP configuration was
   * fixed before this call and a newly added tool cannot have reached it.
   */
  sessionAlreadyLive: boolean
}

export function hostToolWarnings(
  input: HostToolWarningInput,
): LanguageModelV2CallWarning[] {
  const requested = (input.tools ?? [])
    .filter((t) => t.type === 'function')
    .map((t) => t.name)
  if (requested.length === 0) return []

  const declared = new Set(input.declared)
  const warnings: LanguageModelV2CallWarning[] = []

  const unservable = requested.filter((name) => !declared.has(name))
  if (unservable.length > 0) {
    warnings.push({
      type: 'other',
      message:
        `tools [${unservable.join(', ')}] were passed to the model but are ` +
        'not declared in `hostTools`, so the agent cannot call them. The AI ' +
        'SDK does not pass `execute` to a provider, so the function has to ' +
        'be given to `createAcpxProvider({ hostTools: { tools } })` for the ' +
        'provider to answer it over MCP.',
    })
  }

  const servable = requested.filter((name) => declared.has(name))
  if (servable.length > 0 && input.sessionAlreadyLive) {
    warnings.push({
      type: 'other',
      message:
        "this session was already live, and ACP fixes a session's MCP " +
        'configuration when it is created, so any change to `hostTools` ' +
        'since then has not reached the agent. Use a distinct `sessionKey` ' +
        'for a different tool set.',
    })
  }

  return warnings
}
