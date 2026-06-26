import { describe, expect, test } from 'bun:test'
import { decodeBridgeCoords, pickResumeCoords } from '../../src/host-attach.ts'

const VALID_COORDS = {
  port: 4001,
  token: 'tok',
  lastSeenEventId: 12,
  sandboxId: 'sbx-1',
}

describe('decodeBridgeCoords', () => {
  test('returns undefined for missing state', () => {
    expect(decodeBridgeCoords(undefined)).toBeUndefined()
  })

  test('returns undefined when data has no bridge block', () => {
    expect(
      decodeBridgeCoords({
        type: 'resume-session',
        harnessId: 'acpx',
        specificationVersion: 'harness-v1',
        data: { sessionKey: 'x' },
      }),
    ).toBeUndefined()
  })

  test('decodes a valid bridge block', () => {
    const out = decodeBridgeCoords({
      type: 'resume-session',
      harnessId: 'acpx',
      specificationVersion: 'harness-v1',
      data: { bridge: VALID_COORDS },
    })
    expect(out).toEqual(VALID_COORDS)
  })

  test('rejects a malformed bridge block', () => {
    expect(
      decodeBridgeCoords({
        type: 'resume-session',
        harnessId: 'acpx',
        specificationVersion: 'harness-v1',
        data: { bridge: { port: 'not-a-number' } },
      }),
    ).toBeUndefined()
  })
})

describe('pickResumeCoords', () => {
  test('prefers continueFrom over resumeFrom when both are present', () => {
    const continueCoords = { ...VALID_COORDS, port: 5050 }
    const out = pickResumeCoords({
      sessionId: 's',
      sessionWorkDir: '/tmp/x',
      sandboxSession: {} as never,
      continueFrom: {
        type: 'continue-turn',
        harnessId: 'acpx',
        specificationVersion: 'harness-v1',
        data: { bridge: continueCoords },
      },
      resumeFrom: {
        type: 'resume-session',
        harnessId: 'acpx',
        specificationVersion: 'harness-v1',
        data: { bridge: VALID_COORDS },
      },
    } as never)
    expect(out?.port).toBe(5050)
  })

  test('falls back to resumeFrom when continueFrom has no bridge block', () => {
    const out = pickResumeCoords({
      sessionId: 's',
      sessionWorkDir: '/tmp/x',
      sandboxSession: {} as never,
      continueFrom: {
        type: 'continue-turn',
        harnessId: 'acpx',
        specificationVersion: 'harness-v1',
        data: {},
      },
      resumeFrom: {
        type: 'resume-session',
        harnessId: 'acpx',
        specificationVersion: 'harness-v1',
        data: { bridge: VALID_COORDS },
      },
    } as never)
    expect(out).toEqual(VALID_COORDS)
  })

  test('returns undefined when neither payload carries bridge coords', () => {
    expect(
      pickResumeCoords({
        sessionId: 's',
        sessionWorkDir: '/tmp/x',
        sandboxSession: {} as never,
      } as never),
    ).toBeUndefined()
  })
})
