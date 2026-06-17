import { describe, expect, test } from 'bun:test'
import {
  isDirectoryExistsError,
  isFileNotFoundError,
} from '../../src/errors.ts'

describe('isFileNotFoundError', () => {
  test('returns true for code "ENOENT"', () => {
    expect(isFileNotFoundError({ code: 'ENOENT' })).toBe(true)
  })

  test('returns true for code "NotFound" (microsandbox style)', () => {
    expect(isFileNotFoundError({ code: 'NotFound' })).toBe(true)
  })

  test('returns true for message containing "no such file"', () => {
    expect(isFileNotFoundError(new Error('no such file or directory'))).toBe(
      true,
    )
  })

  test('returns true for message containing "does not exist"', () => {
    expect(isFileNotFoundError(new Error('path does not exist'))).toBe(true)
  })

  test('returns true for message containing "ENOENT" (case-insensitive)', () => {
    expect(isFileNotFoundError(new Error('enoent: missing file'))).toBe(true)
  })

  test('returns false for an unrelated error', () => {
    expect(isFileNotFoundError(new Error('permission denied'))).toBe(false)
  })

  test('does not match "command not found" (shell exec failure)', () => {
    expect(isFileNotFoundError(new Error('bash: foo: command not found'))).toBe(
      false,
    )
  })

  test('does not match "resource not found" (generic upstream message)', () => {
    expect(isFileNotFoundError(new Error('resource not found'))).toBe(false)
  })

  test('returns false for null / undefined / primitives', () => {
    expect(isFileNotFoundError(null)).toBe(false)
    expect(isFileNotFoundError(undefined)).toBe(false)
    expect(isFileNotFoundError('ENOENT')).toBe(false)
    expect(isFileNotFoundError(42)).toBe(false)
  })
})

describe('isDirectoryExistsError', () => {
  test('returns true for code "EEXIST"', () => {
    expect(isDirectoryExistsError({ code: 'EEXIST' })).toBe(true)
  })

  test('returns true for code "AlreadyExists" (microsandbox style)', () => {
    expect(isDirectoryExistsError({ code: 'AlreadyExists' })).toBe(true)
  })

  test('returns true for message containing "already exists"', () => {
    expect(isDirectoryExistsError(new Error('directory already exists'))).toBe(
      true,
    )
  })

  test('returns false for unrelated errors', () => {
    expect(isDirectoryExistsError(new Error('no such file'))).toBe(false)
  })
})
