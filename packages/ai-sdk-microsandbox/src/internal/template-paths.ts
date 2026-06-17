import { createHash } from 'node:crypto'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

/**
 * Environment variable consumers set to override the default cache root.
 * Useful for tests, CI, and dev sandboxes that want isolation between
 * runs without polluting the user-level cache.
 */
export const CACHE_DIR_ENV_VAR = 'AI_SDK_MICROSANDBOX_CACHE_DIR'

const CACHE_SUBDIR = 'ai-sdk-microsandbox'

/**
 * Resolve the per-user cache root. Honors `AI_SDK_MICROSANDBOX_CACHE_DIR`
 * verbatim; otherwise picks an OS-conventional location:
 *
 * - macOS: `~/Library/Caches/ai-sdk-microsandbox`
 * - Linux: `${XDG_CACHE_HOME:-~/.cache}/ai-sdk-microsandbox`
 * - Windows: `${LOCALAPPDATA:-~\AppData\Local}\ai-sdk-microsandbox`
 *
 * `templates/` is appended for the template subdirectory.
 */
export function resolveTemplatesDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveCacheRoot(env), 'templates')
}

/**
 * Derive a per-template subdirectory from `identity`. Hashes the identity
 * before using it as a filesystem name so:
 * - Path length stays bounded regardless of how long the identity is.
 * - Filesystem-unsafe characters in identity strings don't matter.
 * - Different identities never collide on case-insensitive filesystems.
 */
export function resolveTemplateDirectory(
  templatesDirectory: string,
  identity: string,
): string {
  const hash = createHash('sha256').update(identity).digest('hex').slice(0, 32)
  return join(templatesDirectory, hash)
}

function resolveCacheRoot(env: NodeJS.ProcessEnv): string {
  const override = env[CACHE_DIR_ENV_VAR]
  if (override && override.length > 0) return override

  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Caches', CACHE_SUBDIR)
  }
  if (platform() === 'win32') {
    const localAppData = env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
    return join(localAppData, CACHE_SUBDIR)
  }
  // Linux + other POSIX
  const xdg = env.XDG_CACHE_HOME
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.cache')
  return join(base, CACHE_SUBDIR)
}
