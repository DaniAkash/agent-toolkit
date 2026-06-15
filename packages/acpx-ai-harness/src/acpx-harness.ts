import type { HarnessV1 } from '@ai-sdk/harness'
import { ACPX_BUILTIN_TOOLS } from './acpx-builtin-tools.ts'
import { acpxLifecycleStateSchema } from './acpx-lifecycle.ts'

export interface AcpxHarnessSettings {
  /** ACP agent id, e.g. `'claude'`, `'codex'`, `'gemini'`. */
  readonly agent?: string
  /** Override the agent's default model. */
  readonly model?: string
  /** acpx state directory inside the sandbox. Defaults to acpx's own default. */
  readonly stateDir?: string
  /** Bridge startup timeout in milliseconds. */
  readonly startupTimeoutMs?: number
  /** Override the sandbox port when multiple are exposed. */
  readonly port?: number
}

export function createAcpxHarness(
  _settings: AcpxHarnessSettings = {},
): HarnessV1<typeof ACPX_BUILTIN_TOOLS> {
  return {
    specificationVersion: 'harness-v1',
    harnessId: 'acpx',
    builtinTools: ACPX_BUILTIN_TOOLS,
    supportsBuiltinToolApprovals: true,
    lifecycleStateSchema: acpxLifecycleStateSchema,
    async doStart() {
      throw new Error(
        'acpx-ai-harness: doStart() is not implemented yet. ' +
          'This is a placeholder while the package is under construction.',
      )
    },
  }
}

export const acpxHarness: HarnessV1<typeof ACPX_BUILTIN_TOOLS> =
  createAcpxHarness()
