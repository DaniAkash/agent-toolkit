export type AgentResolveCause =
  | 'acpx_not_installed'
  | 'acpx_incompatible'
  | 'unknown_agent'

export class AgentResolveError extends Error {
  override name = 'AgentResolveError'
  readonly resolveCause: AgentResolveCause
  readonly original?: unknown

  constructor(
    message: string,
    opts: { cause: AgentResolveCause; original?: unknown },
  ) {
    super(message)
    this.resolveCause = opts.cause
    this.original = opts.original
  }
}

export class AcpProbeError extends Error {
  override name = 'AcpProbeError'
}
