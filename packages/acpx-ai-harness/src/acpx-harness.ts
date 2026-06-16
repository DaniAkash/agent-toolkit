import type { HarnessV1, HarnessV1Bootstrap } from '@ai-sdk/harness'
import { installCommandForAgent } from './acpx-agent-installs.ts'
import {
  defaultReadBridgeAsset,
  type ReadBridgeAsset,
} from './acpx-bridge-assets.ts'
import { ACPX_BUILTIN_TOOLS } from './acpx-builtin-tools.ts'
import { acpxLifecycleStateSchema } from './acpx-lifecycle.ts'
import { doStartImpl } from './host-session.ts'

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
  /**
   * Test seam: override the bridge-asset reader. Defaults to reading the
   * shipped `dist/bridge/<name>` files from disk.
   */
  readonly readBridgeAsset?: ReadBridgeAsset
}

const BOOTSTRAP_DIR = '/tmp/harness/acpx'
const DEFAULT_AGENT = 'codex'

export function createAcpxHarness(
  settings: AcpxHarnessSettings = {},
): HarnessV1<typeof ACPX_BUILTIN_TOOLS> {
  const readBridgeAsset = settings.readBridgeAsset ?? defaultReadBridgeAsset
  const agent = settings.agent ?? DEFAULT_AGENT
  let cachedBootstrap: HarnessV1Bootstrap | undefined

  const getBootstrap = async (): Promise<HarnessV1Bootstrap> => {
    if (cachedBootstrap) return cachedBootstrap
    const [pkg, bundle] = await Promise.all([
      readBridgeAsset('package.json'),
      readBridgeAsset('index.js'),
    ])
    const installAgent = installCommandForAgent(agent)
    cachedBootstrap = {
      harnessId: 'acpx',
      bootstrapDir: BOOTSTRAP_DIR,
      files: [
        { path: `${BOOTSTRAP_DIR}/package.json`, content: pkg },
        { path: `${BOOTSTRAP_DIR}/bridge.mjs`, content: bundle },
      ],
      commands: [
        { command: `mkdir -p ${BOOTSTRAP_DIR}` },
        {
          command: `pnpm --dir ${BOOTSTRAP_DIR} install --no-frozen-lockfile --store-dir ${BOOTSTRAP_DIR}/.pnpm-store`,
        },
        ...(installAgent ? [{ command: installAgent }] : []),
        {
          command: `cd ${BOOTSTRAP_DIR} && ./node_modules/.bin/acpx --version`,
        },
      ],
    }
    return cachedBootstrap
  }

  return {
    specificationVersion: 'harness-v1',
    harnessId: 'acpx',
    builtinTools: ACPX_BUILTIN_TOOLS,
    supportsBuiltinToolApprovals: true,
    lifecycleStateSchema: acpxLifecycleStateSchema,
    getBootstrap,
    doStart: (startOptions) => doStartImpl(settings, startOptions),
  }
}

export const acpxHarness: HarnessV1<typeof ACPX_BUILTIN_TOOLS> =
  createAcpxHarness()
