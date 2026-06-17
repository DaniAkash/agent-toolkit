import { describe, expect, test } from 'bun:test'
import * as pkg from '../../src/index.ts'

describe('ai-sdk-microsandbox package surface', () => {
  test('module loads without throwing', () => {
    expect(pkg).toBeDefined()
  })

  test('exports MicrosandboxSandboxSession', () => {
    expect(pkg.MicrosandboxSandboxSession).toBeDefined()
    expect(typeof pkg.MicrosandboxSandboxSession).toBe('function')
  })
})
