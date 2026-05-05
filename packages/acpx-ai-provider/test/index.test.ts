import { describe, expect, test } from 'bun:test'
import { VERSION } from '../src/index.ts'

describe('acpx-ai-provider', () => {
  test('exports VERSION sentinel', () => {
    expect(VERSION).toBe('0.0.0')
  })
})
