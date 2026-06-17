import { describe, expect, test } from 'bun:test'
import * as pkg from '../../src/index.ts'

describe('ai-sdk-microsandbox package surface', () => {
  test('module loads without throwing', () => {
    expect(pkg).toBeDefined()
  })

  test('public surface is empty in the scaffold release', () => {
    expect(Object.keys(pkg)).toEqual([])
  })
})
