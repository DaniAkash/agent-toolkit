/**
 * Heuristic detection for "file does not exist" errors from microsandbox's
 * filesystem operations. microsandbox's TS SDK maps native errors through
 * `withMappedErrors`, but the resulting shape isn't fully stabilised — accept
 * the common code values and message patterns rather than pin to one.
 */
export function isFileNotFoundError(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  if (code === 'ENOENT' || code === 'NotFound') return true
  const message = (error as { message?: unknown }).message
  if (typeof message !== 'string') return false
  return /no such file|not found|does not exist|enoent/i.test(message)
}

/**
 * Heuristic detection for "directory already exists" errors from microsandbox
 * `fs().mkdir(path)`. Used to make our explicit mkdir-before-write idempotent
 * regardless of whether microsandbox's mkdir errors on existing paths.
 */
export function isDirectoryExistsError(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  if (code === 'EEXIST' || code === 'AlreadyExists') return true
  const message = (error as { message?: unknown }).message
  if (typeof message !== 'string') return false
  return /already exists|file exists|eexist/i.test(message)
}
