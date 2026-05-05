import type { AcpxProviderSettings } from './types.ts'

export type {
  ConvertPromptAttachment,
  ConvertPromptInput,
  ConvertPromptMode,
  ConvertPromptOutput,
} from './convert-prompt.ts'
export { convertPrompt } from './convert-prompt.ts'
export type { AcpxErrorOptions } from './errors.ts'
export {
  AcpxAgentNotFoundError,
  AcpxAuthRequiredError,
  AcpxError,
  AcpxTurnTimeoutError,
  fromRuntimeError,
} from './errors.ts'

export type {
  AcpRuntime,
  AcpRuntimeDoctorReport,
  AcpRuntimeEvent,
  AcpRuntimeHandle,
  AcpRuntimeTurnResult,
  AcpRuntimeTurnResultError,
  AcpxLanguageModelOptions,
  AcpxMcpServerConfig,
  AcpxMcpServerHttp,
  AcpxMcpServerStdio,
  AcpxNonInteractivePermissions,
  AcpxPermissionMode,
  AcpxProviderSettings,
  AcpxSessionMode,
} from './types.ts'

const NOT_IMPLEMENTED =
  'createAcpxProvider is not wired up yet — landing in a follow-up release. See https://github.com/DaniAkash/acpx for progress.'

export function createAcpxProvider(_settings: AcpxProviderSettings): never {
  throw new Error(NOT_IMPLEMENTED)
}

export const VERSION = '0.0.0'
