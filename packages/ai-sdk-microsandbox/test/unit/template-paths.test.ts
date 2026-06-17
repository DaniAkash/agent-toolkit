import { describe, expect, test } from 'bun:test'
import { join, sep } from 'node:path'
import {
  CACHE_DIR_ENV_VAR,
  resolveTemplateDirectory,
  resolveTemplatesDirectory,
} from '../../src/internal/template-paths.ts'

// Build the expected `<templatesDir><sep>` prefix using the platform's
// path separator so assertions hold on POSIX and Windows.
const TEMPLATES_DIR = join('/tmp', 'templates')
const TEMPLATES_PREFIX = `${TEMPLATES_DIR}${sep}`

describe('resolveTemplatesDirectory', () => {
  test('honors the override env var verbatim', () => {
    const root = resolveTemplatesDirectory({
      [CACHE_DIR_ENV_VAR]: '/custom/root',
    })
    expect(root).toBe(join('/custom/root', 'templates'))
  })

  test('falls back to OS conventions when the env var is unset', () => {
    const root = resolveTemplatesDirectory({})
    expect(root.endsWith(join('ai-sdk-microsandbox', 'templates'))).toBe(true)
    expect(root.length).toBeGreaterThan(20)
  })

  test('falls back to OS conventions when the env var is empty string', () => {
    const fromUnset = resolveTemplatesDirectory({})
    const fromEmpty = resolveTemplatesDirectory({ [CACHE_DIR_ENV_VAR]: '' })
    expect(fromEmpty).toBe(fromUnset)
  })
})

describe('resolveTemplateDirectory', () => {
  test('returns a path under the templates directory', () => {
    const path = resolveTemplateDirectory(TEMPLATES_DIR, 'claude-code-v1')
    expect(path.startsWith(TEMPLATES_PREFIX)).toBe(true)
  })

  test('hashes the identity so the directory name is filesystem-safe', () => {
    const path = resolveTemplateDirectory(
      TEMPLATES_DIR,
      'claude-code/v1:with::special#chars',
    )
    // Strip the prefix; the remaining segment should be pure hex.
    const segment = path.slice(TEMPLATES_PREFIX.length)
    expect(segment).toMatch(/^[0-9a-f]+$/)
    expect(segment).not.toContain(':')
    expect(segment).not.toContain('#')
  })

  test('different identities produce different directory paths', () => {
    const a = resolveTemplateDirectory(TEMPLATES_DIR, 'identity-a')
    const b = resolveTemplateDirectory(TEMPLATES_DIR, 'identity-b')
    expect(a).not.toBe(b)
  })

  test('same identity is deterministic across calls', () => {
    const a = resolveTemplateDirectory(TEMPLATES_DIR, 'fixed')
    const b = resolveTemplateDirectory(TEMPLATES_DIR, 'fixed')
    expect(a).toBe(b)
  })

  test('hashed segment is 32 hex chars', () => {
    const path = resolveTemplateDirectory(TEMPLATES_DIR, 'whatever')
    const segment = path.slice(TEMPLATES_PREFIX.length)
    expect(segment).toMatch(/^[0-9a-f]{32}$/)
  })
})
