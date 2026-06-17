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
   * Auth credentials threaded into acpx's config inside the sandbox.
   * Keys are method ids (e.g. `openai_api_key`, `anthropic_api_key`,
   * `gemini_api_key`) and values are the raw credentials. The harness
   * writes these to `~/.acpx/config.json` before every session start —
   * per-session so credentials never end up in the sandbox snapshot.
   *
   * Per https://acpx.sh/config.html: standard provider env vars like
   * `OPENAI_API_KEY` reach child processes but DON'T drive acpx's own
   * auth gate. The wrapper agents (codex-acp, claude-agent-acp) expect
   * ACP-level authentication, which acpx only performs when these
   * credentials are configured.
   */
  readonly auth?: Readonly<Record<string, string>>
  /**
   * Controls acpx's `authPolicy`. Defaults to `'fail'` when `auth` is
   * non-empty (fail fast on missing credentials), `'skip'` otherwise.
   * Override only if you know what you're doing.
   */
  readonly authPolicy?: 'skip' | 'fail'
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
