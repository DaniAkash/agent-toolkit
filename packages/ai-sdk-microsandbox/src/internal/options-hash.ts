import { createHash } from 'node:crypto'
import type { MicrosandboxCreateSettings } from '../settings.ts'

/**
 * Snapshot-affecting subset of {@link MicrosandboxCreateSettings}. Only
 * fields whose values are baked into the captured template appear here;
 * runtime-only settings (cpus, memory, ports, env, networkPolicy) are
 * applied to the fork at session-create time and are intentionally omitted.
 *
 * If a caller wants env or other fields to participate in cache identity
 * they encode that into `identity` itself — matches the contract the
 * harness adapters (`@ai-sdk/harness-claude-code` etc.) already follow.
 */
interface SnapshotInputs {
  readonly image: string
  readonly workdir: string | null
}

/**
 * Compute a stable hex digest of the bootstrap-affecting settings. Same
 * settings → same hash across processes and Node versions. Different
 * `image` or `workdir` values → different hash.
 *
 * Field order in the input doesn't matter; we canonicalise before hashing
 * so an object reordered between calls produces the same digest.
 */
export function computeOptionsHash(
  settings: MicrosandboxCreateSettings,
): string {
  const inputs: SnapshotInputs = {
    image: settings.image,
    workdir: settings.workdir ?? null,
  }
  const canonical = JSON.stringify(inputs, Object.keys(inputs).sort())
  return createHash('sha256').update(canonical).digest('hex')
}
