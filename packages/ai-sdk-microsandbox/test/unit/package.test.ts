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

  test('exports MicrosandboxNetworkSandboxSession', () => {
    expect(pkg.MicrosandboxNetworkSandboxSession).toBeDefined()
    expect(typeof pkg.MicrosandboxNetworkSandboxSession).toBe('function')
  })

  test('exports translateNetworkPolicy', () => {
    expect(typeof pkg.translateNetworkPolicy).toBe('function')
  })

  test('exports settings helpers', () => {
    expect(typeof pkg.validateMicrosandboxSettings).toBe('function')
    expect(typeof pkg.isMicrosandboxCreateSettings).toBe('function')
    expect(pkg.MicrosandboxSettingsError).toBeDefined()
    expect(pkg.DEFAULT_PUBLIC_HOSTNAME).toBe('127.0.0.1')
  })

  test('exports VERSION sentinel', () => {
    expect(pkg.VERSION).toBe('0.0.0')
  })
})
