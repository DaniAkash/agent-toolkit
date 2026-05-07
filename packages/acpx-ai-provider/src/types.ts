import type {
  AcpRuntime,
  AcpRuntimeDoctorReport,
  AcpRuntimeEvent,
  AcpRuntimeHandle,
  AcpRuntimeSessionModels,
  AcpRuntimeStatus,
  AcpRuntimeTurnResult,
  AcpRuntimeTurnResultError,
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
  AcpRuntimeSessionModels,
  AcpRuntimeStatus,
  AcpRuntimeTurnResult,
  AcpRuntimeTurnResultError,
}
