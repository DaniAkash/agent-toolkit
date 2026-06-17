import { Sandbox } from 'microsandbox'

/**
 * Best-effort cleanup of e2e-produced sandboxes. Kills any sandbox whose
 * name starts with `ai-sdk-harness-` or `ai-sdk-tpl-src-`. Snapshot cleanup
 * is intentionally NOT done here. The snapshot is the shared bootstrap
 * fixture every test reuses, and keeping it across runs is what makes the
 * suite fast.
 *
 * Run manually with `bun run test:e2e:cleanup` to fully wipe state.
 */
export async function purgeE2eSandboxes(): Promise<void> {
  const handles = await Sandbox.list().catch(() => [])
  for (const h of handles) {
    const cfg = h.config() as { name?: string }
    if (typeof cfg.name !== 'string') continue
    if (
      cfg.name.startsWith('ai-sdk-harness-') ||
      cfg.name.startsWith('ai-sdk-tpl-src-')
    ) {
      try {
        await h.kill()
      } catch {
        // ignore; sandbox may already be gone
      }
    }
  }
}
