export type { AgentResolveCause } from './errors.ts'
export { AcpProbeError, AgentResolveError } from './errors.ts'
export { probeAgent } from './probe.ts'
export { splitArgv } from './resolve-command.ts'
export type {
  AgentCapabilities,
  AgentInfo,
  AgentProbeRequest,
  AgentProbeResult,
  AuthMethod,
  McpCapabilities,
  ProbedConfigOption,
  ProbedConfigOptionValue,
  ProbedMode,
  ProbedModel,
  ProbeError,
  ProbeErrorCode,
  PromptCapabilities,
  ReasoningInfo,
  SessionCapabilities,
} from './types.ts'

export const VERSION = '0.0.0'
