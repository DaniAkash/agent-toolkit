import type { Experimental_SandboxSession } from '@ai-sdk/provider-utils'
import type { AcpxHarnessSettings } from './acpx-harness.ts'

/**
 * Default location acpx reads its global config from inside the sandbox.
 * Per https://acpx.sh/config.html the runtime walks
 * `~/.acpx/config.json` then `<cwd>/.acpxrc.json`. We target the global
 * one so config applies regardless of which working directory the
 * agent runs in.
 *
 * The path is hard-coded because Vercel sandbox always runs commands as
 * the `vercel-sandbox` user (per `/docs/sandbox/system-specifications`)
 * with a stable home. If you ever need to override this for a different
 * sandbox provider, swap the constant.
 */
export const ACPX_CONFIG_PATH = '/home/vercel-sandbox/.acpx/config.json'

/**
 * Build the JSON body for `~/.acpx/config.json` from harness settings.
 * Returns `undefined` when there's nothing to write (no `auth` block
 * and no explicit `authPolicy`) so the caller can skip the IO.
 */
export function buildAcpxConfigBody(
  settings: AcpxHarnessSettings,
): string | undefined {
  const auth = settings.auth ?? {}
  const hasAuth = Object.keys(auth).length > 0
  const authPolicy = settings.authPolicy ?? (hasAuth ? 'fail' : undefined)
  if (!hasAuth && !authPolicy) return undefined

  const body: Record<string, unknown> = {}
  if (hasAuth) body.auth = auth
  if (authPolicy) body.authPolicy = authPolicy
  return JSON.stringify(body, null, 2)
}

/**
 * Write `~/.acpx/config.json` inside the sandbox before the bridge
 * spawns. Runs per session, never via the bootstrap recipe, because the
 * bootstrap recipe's files get baked into the Vercel sandbox snapshot
 * and we never want credentials in a snapshot.
 *
 * Best-effort: if the write fails (e.g. sandbox provider doesn't
 * support writeTextFile or the path is wrong for the runtime), the
 * function throws so doStart can surface a clear error.
 */
export async function writeAcpxConfigIfNeeded(
  sandbox: Experimental_SandboxSession,
  settings: AcpxHarnessSettings,
): Promise<void> {
  const body = buildAcpxConfigBody(settings)
  if (!body) return
  await sandbox.writeTextFile({ path: ACPX_CONFIG_PATH, content: body })
}
