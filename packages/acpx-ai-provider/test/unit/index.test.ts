import { describe, expect, test } from 'bun:test'
import { createAcpxProvider, VERSION } from '../../src/index.ts'

describe('package surface', () => {
  test('exports VERSION sentinel', () => {
    expect(VERSION).toBe('0.0.0')
  })

  test('createAcpxProvider throws until wired up', () => {
    expect(() => createAcpxProvider({ agent: 'claude' })).toThrow(
      /not wired up/,
    )
  })
})
