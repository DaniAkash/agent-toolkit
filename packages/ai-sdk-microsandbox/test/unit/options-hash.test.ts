import { describe, expect, test } from 'bun:test'
import { computeOptionsHash } from '../../src/internal/options-hash.ts'

describe('computeOptionsHash', () => {
  test('same settings produce the same hash', () => {
    const a = computeOptionsHash({ image: 'debian' })
    const b = computeOptionsHash({ image: 'debian' })
    expect(a).toBe(b)
  })

  test('different image → different hash', () => {
    const a = computeOptionsHash({ image: 'debian' })
    const b = computeOptionsHash({ image: 'ubuntu' })
    expect(a).not.toBe(b)
  })

  test('different workdir → different hash', () => {
    const a = computeOptionsHash({ image: 'debian', workdir: '/a' })
    const b = computeOptionsHash({ image: 'debian', workdir: '/b' })
    expect(a).not.toBe(b)
  })

  test('runtime-only settings do not affect the hash', () => {
    const a = computeOptionsHash({ image: 'debian', cpus: 1, memory: 1024 })
    const b = computeOptionsHash({ image: 'debian', cpus: 8, memory: 8192 })
    expect(a).toBe(b)
  })

  test('ports do not affect the hash', () => {
    const a = computeOptionsHash({ image: 'debian' })
    const b = computeOptionsHash({
      image: 'debian',
      ports: [{ host: 8080, guest: 80 }],
    })
    expect(a).toBe(b)
  })

  test('env does not affect the hash', () => {
    const a = computeOptionsHash({ image: 'debian' })
    const b = computeOptionsHash({ image: 'debian', env: { FOO: 'bar' } })
    expect(a).toBe(b)
  })

  test('hash is a 64-char hex string (sha256 hex digest)', () => {
    const hash = computeOptionsHash({ image: 'debian' })
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  test('missing optional fields hash the same as undefined fields', () => {
    const a = computeOptionsHash({ image: 'debian' })
    const b = computeOptionsHash({ image: 'debian', workdir: undefined })
    expect(a).toBe(b)
  })

  test('hash is stable across runs (snapshot value for fixed input)', () => {
    expect(computeOptionsHash({ image: 'debian', workdir: '/workspace' })).toBe(
      // Pre-computed once; bump alongside any deliberate hash-format change.
      'a919dfda18d7b8b33b98532dc0278554921bfd2c9fa7971d35c9e2d5e1c24911',
    )
  })
})
