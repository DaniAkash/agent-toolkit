import { describe, expect, test } from 'bun:test'
import {
  ACPX_CONFIG_PATH,
  buildAcpxAuthEnv,
  buildAcpxConfigBody,
} from '../../src/host-acpx-config.ts'

describe('ACPX_CONFIG_PATH', () => {
  test('points at the vercel-sandbox user home', () => {
    expect(ACPX_CONFIG_PATH).toBe('/home/vercel-sandbox/.acpx/config.json')
  })
})

describe('buildAcpxConfigBody', () => {
  test('returns undefined when no auth or authPolicy is set', () => {
    expect(buildAcpxConfigBody({})).toBeUndefined()
  })

  test('returns undefined when auth is an empty object and no authPolicy', () => {
    expect(buildAcpxConfigBody({ auth: {} })).toBeUndefined()
  })

  test('writes auth and defaults authPolicy to fail when auth is non-empty', () => {
    const body = buildAcpxConfigBody({ auth: { openai_api_key: 'sk-x' } })
    expect(body).toBeDefined()
    const parsed = JSON.parse(body!)
    expect(parsed).toEqual({
      auth: { openai_api_key: 'sk-x' },
      authPolicy: 'fail',
    })
  })

  test('honours an explicit authPolicy override', () => {
    const body = buildAcpxConfigBody({
      auth: { openai_api_key: 'sk-x' },
      authPolicy: 'skip',
    })
    const parsed = JSON.parse(body!)
    expect(parsed.authPolicy).toBe('skip')
  })

  test('writes authPolicy alone when no auth block is provided', () => {
    const body = buildAcpxConfigBody({ authPolicy: 'fail' })
    expect(body).toBeDefined()
    const parsed = JSON.parse(body!)
    expect(parsed).toEqual({ authPolicy: 'fail' })
  })

  test('preserves multiple auth keys', () => {
    const body = buildAcpxConfigBody({
      auth: {
        openai_api_key: 'sk-a',
        anthropic_api_key: 'sk-b',
        gemini_api_key: 'g-c',
      },
    })
    const parsed = JSON.parse(body!)
    expect(parsed.auth).toEqual({
      openai_api_key: 'sk-a',
      anthropic_api_key: 'sk-b',
      gemini_api_key: 'g-c',
    })
  })
})

describe('buildAcpxAuthEnv', () => {
  test('returns an empty map when auth is undefined', () => {
    expect(buildAcpxAuthEnv({})).toEqual({})
  })

  test('returns an empty map when auth is an empty object', () => {
    expect(buildAcpxAuthEnv({ auth: {} })).toEqual({})
  })

  test('upper-cases the method id into ACPX_AUTH_<METHOD_ID>', () => {
    expect(
      buildAcpxAuthEnv({ auth: { openai_api_key: 'sk-x' } }),
    ).toEqual({ ACPX_AUTH_OPENAI_API_KEY: 'sk-x' })
  })

  test('maps multiple auth keys independently', () => {
    expect(
      buildAcpxAuthEnv({
        auth: {
          openai_api_key: 'a',
          anthropic_api_key: 'b',
          gemini_api_key: 'c',
        },
      }),
    ).toEqual({
      ACPX_AUTH_OPENAI_API_KEY: 'a',
      ACPX_AUTH_ANTHROPIC_API_KEY: 'b',
      ACPX_AUTH_GEMINI_API_KEY: 'c',
    })
  })
})
