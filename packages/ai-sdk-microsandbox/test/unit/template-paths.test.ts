import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  CACHE_DIR_ENV_VAR,
  resolveTemplateDirectory,
  resolveTemplatesDirectory,
} from '../../src/internal/template-paths.ts'

describe('resolveTemplatesDirectory', () => {
  test('honors the override env var verbatim', () => {
    const root = resolveTemplatesDirectory({ [CACHE_DIR_ENV_VAR]: '/custom/root' })
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
    const path = resolveTemplateDirectory('/tmp/templates', 'claude-code-v1')
    expect(path.startsWith('/tmp/templates/')).toBe(true)
  })

  test('hashes the identity so the directory name is filesystem-safe', () => {
    const path = resolveTemplateDirectory(
      '/tmp/templates',
      'claude-code/v1:with::special#chars',
    )
    expect(path).not.toContain('/with')
    expect(path).not.toContain(':')
    expect(path).not.toContain('#')
  })

  test('different identities produce different directory paths', () => {
    const a = resolveTemplateDirectory('/tmp/templates', 'identity-a')
    const b = resolveTemplateDirectory('/tmp/templates', 'identity-b')
    expect(a).not.toBe(b)
  })

  test('same identity is deterministic across calls', () => {
    const a = resolveTemplateDirectory('/tmp/templates', 'fixed')
    const b = resolveTemplateDirectory('/tmp/templates', 'fixed')
    expect(a).toBe(b)
  })

  test('hashed segment is 32 hex chars', () => {
    const path = resolveTemplateDirectory('/tmp/templates', 'whatever')
    const segment = path.replace('/tmp/templates/', '')
    expect(segment).toMatch(/^[0-9a-f]{32}$/)
  })
})
