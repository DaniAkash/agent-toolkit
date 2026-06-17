import { describe, expect, test } from 'bun:test'
import type { Sandbox } from 'microsandbox'
import {
  isMicrosandboxCreateSettings,
  type MicrosandboxSettings,
  MicrosandboxSettingsError,
  validateMicrosandboxSettings,
} from '../../src/settings.ts'

const fakeSandbox = {} as unknown as Sandbox

describe('validateMicrosandboxSettings — create mode', () => {
  test('accepts minimal valid settings', () => {
    expect(() =>
      validateMicrosandboxSettings({ image: 'debian' }),
    ).not.toThrow()
  })

  test('accepts a full create-mode settings object', () => {
    expect(() =>
      validateMicrosandboxSettings({
        image: 'debian',
        cpus: 2,
        memory: 2048,
        workdir: '/workspace',
        ports: [
          { host: 8080, guest: 80 },
          { host: 9090, guest: 90, bind: '0.0.0.0' },
        ],
        env: { FOO: 'bar' },
      }),
    ).not.toThrow()
  })

  test('rejects missing image', () => {
    expect(() =>
      validateMicrosandboxSettings({ image: '' } as MicrosandboxSettings),
    ).toThrow(MicrosandboxSettingsError)
  })

  test('rejects non-positive cpus', () => {
    expect(() =>
      validateMicrosandboxSettings({ image: 'debian', cpus: 0 }),
    ).toThrow(/cpus/)
    expect(() =>
      validateMicrosandboxSettings({ image: 'debian', cpus: -1 }),
    ).toThrow(/cpus/)
  })

  test('rejects non-positive memory', () => {
    expect(() =>
      validateMicrosandboxSettings({ image: 'debian', memory: 0 }),
    ).toThrow(/memory/)
  })

  test('rejects out-of-range host port', () => {
    expect(() =>
      validateMicrosandboxSettings({
        image: 'debian',
        ports: [{ host: 99999, guest: 80 }],
      }),
    ).toThrow(/host port/)
  })

  test('rejects host port 0 (unusable in URLs)', () => {
    expect(() =>
      validateMicrosandboxSettings({
        image: 'debian',
        ports: [{ host: 0, guest: 80 }],
      }),
    ).toThrow(/host port/)
  })

  test('rejects guest port 0', () => {
    expect(() =>
      validateMicrosandboxSettings({
        image: 'debian',
        ports: [{ host: 8080, guest: 0 }],
      }),
    ).toThrow(/guest port/)
  })

  test('rejects out-of-range guest port', () => {
    expect(() =>
      validateMicrosandboxSettings({
        image: 'debian',
        ports: [{ host: 80, guest: -1 }],
      }),
    ).toThrow(/guest port/)
  })

  test('rejects duplicate host ports', () => {
    expect(() =>
      validateMicrosandboxSettings({
        image: 'debian',
        ports: [
          { host: 8080, guest: 80 },
          { host: 8080, guest: 90 },
        ],
      }),
    ).toThrow(/duplicate/)
  })

  test('accepts an empty ports array', () => {
    expect(() =>
      validateMicrosandboxSettings({ image: 'debian', ports: [] }),
    ).not.toThrow()
  })

  test('rejects an empty name', () => {
    expect(() =>
      validateMicrosandboxSettings({ image: 'debian', name: '' }),
    ).toThrow(/name/)
  })

  test('rejects a name longer than 128 UTF-8 bytes', () => {
    expect(() =>
      validateMicrosandboxSettings({
        image: 'debian',
        name: 'a'.repeat(129),
      }),
    ).toThrow(/128 UTF-8/)
  })

  test('rejects multi-byte names whose byte length exceeds the limit', () => {
    // ⭐ encodes to 3 UTF-8 bytes; 50 stars = 150 bytes, exceeds 128.
    expect(() =>
      validateMicrosandboxSettings({
        image: 'debian',
        name: '⭐'.repeat(50),
      }),
    ).toThrow(/128 UTF-8/)
  })

  test('accepts an in-range name', () => {
    expect(() =>
      validateMicrosandboxSettings({ image: 'debian', name: 'short-name' }),
    ).not.toThrow()
  })

  test('error carries a typed code', () => {
    try {
      validateMicrosandboxSettings({ image: 'debian', cpus: 0 })
      throw new Error('expected to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(MicrosandboxSettingsError)
      expect((error as MicrosandboxSettingsError).code).toBe('INVALID_CPUS')
    }
  })
})

describe('validateMicrosandboxSettings — wrap mode', () => {
  test('accepts a wrap-mode settings object', () => {
    expect(() =>
      validateMicrosandboxSettings({ sandbox: fakeSandbox }),
    ).not.toThrow()
  })

  test('accepts wrap mode with bridgePorts and publicHostname', () => {
    expect(() =>
      validateMicrosandboxSettings({
        sandbox: fakeSandbox,
        bridgePorts: [4000, 4001],
        publicHostname: 'sandbox.example.com',
      }),
    ).not.toThrow()
  })
})

describe('isMicrosandboxCreateSettings', () => {
  test('returns true for create-mode settings', () => {
    expect(isMicrosandboxCreateSettings({ image: 'debian' })).toBe(true)
  })

  test('returns false for wrap-mode settings', () => {
    expect(isMicrosandboxCreateSettings({ sandbox: fakeSandbox })).toBe(false)
  })
})
