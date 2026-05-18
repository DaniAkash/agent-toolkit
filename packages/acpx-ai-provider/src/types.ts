import type {
  AcpRuntime,
  AcpRuntimeDoctorReport,
  AcpRuntimeEvent,
  AcpRuntimeHandle,
  AcpRuntimeTurnResult,
  AcpRuntimeTurnResultError,
  SessionAgentOptions,
  SystemPromptOption,
} from 'acpx/runtime'

export type AcpxPermissionMode = 'approve-all' | 'approve-reads' | 'deny-all'
export type AcpxNonInteractivePermissions = 'deny' | 'fail'
export type AcpxSessionMode = 'persistent' | 'oneshot'

export interface AcpxMcpServerStdio {
  type: 'stdio'
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface AcpxMcpServerHttp {
  type: 'http' | 'sse'
  name: string
  url: string
  headers?: Record<string, string>
}

export type AcpxMcpServerConfig = AcpxMcpServerStdio | AcpxMcpServerHttp

export interface AcpxProviderSettings {
  agent: string
  cwd?: string
  sessionKey?: string
  sessionMode?: AcpxSessionMode
  permissionMode?: AcpxPermissionMode
  nonInteractivePermissions?: AcpxNonInteractivePermissions
  mcpServers?: AcpxMcpServerConfig[]
  agentRegistryOverrides?: Record<string, string>
  stateDir?: string
  resumeSessionId?: string
  turnTimeoutMs?: number
  runtime?: AcpRuntime
  /**
   * Per-session agent options forwarded to `AcpRuntime.ensureSession`.
   * Applied when a fresh ACP session is created; ignored when an existing
   * persistent session is reused (system prompts are fixed at newSession
   * time). To apply a different `systemPrompt` for the same workspace,
   * use a distinct `sessionKey`. Calling `close()` does not help here —
   * it keeps the persistent record, so the next `ensureSession` reloads
   * it and re-applies the original options.
   */
  sessionOptions?: SessionAgentOptions
  _internal?: {
    generateId?: () => string
    now?: () => Date
  }
}

export interface AcpxLanguageModelOptions {
  sessionKey?: string
  agent?: string
  mode?: string
}

export type {
  AcpRuntime,
  AcpRuntimeDoctorReport,
  AcpRuntimeEvent,
  AcpRuntimeHandle,
  AcpRuntimeTurnResult,
  AcpRuntimeTurnResultError,
  SessionAgentOptions,
  SystemPromptOption,
}
