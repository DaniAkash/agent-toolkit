import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  InitializeResponse,
  NewSessionResponse,
} from '@agentclientprotocol/sdk'
import {
  deriveModelConfig,
  deriveReasoning,
  normalizeAgentInfo,
  normalizeAuthMethods,
  normalizeCapabilities,
  normalizeConfigOptions,
  normalizeModels,
  normalizeModes,
} from '../../src/_internal/normalize.ts'

const FIXTURES = new URL('../fixtures/', import.meta.url).pathname

async function loadInitialize(agent: string): Promise<InitializeResponse> {
  return JSON.parse(
    await readFile(join(FIXTURES, `${agent}-initialize.json`), 'utf8'),
  )
}

async function loadNewSession(agent: string): Promise<NewSessionResponse> {
  return JSON.parse(
    await readFile(join(FIXTURES, `${agent}-newsession.json`), 'utf8'),
  )
}

describe('normalize — claude (claude-agent-acp 0.31.4)', () => {
  test('agentInfo + capabilities + authMethods', async () => {
    const init = await loadInitialize('claude')

    expect(normalizeAgentInfo(init)).toEqual({
      name: '@agentclientprotocol/claude-agent-acp',
      title: 'Claude Agent',
      version: '0.31.4',
    })

    const caps = normalizeCapabilities(init)
    expect(caps.loadSession).toBe(true)
    expect(caps.promptCapabilities).toEqual({
      image: true,
      audio: false,
      embeddedContext: true,
    })
    expect(caps.mcpCapabilities).toEqual({ http: true, sse: true })
    expect(caps.sessionCapabilities).toEqual({
      close: true,
      list: true,
      resume: true,
      fork: true,
      additionalDirectories: false,
    })

    expect(normalizeAuthMethods(init)).toEqual([])
  })

  test('models + modes + configOptions + reasoning', async () => {
    const sess = await loadNewSession('claude')

    expect(normalizeModels(sess)).toHaveLength(3)
    expect(normalizeModels(sess)[0]?.id).toBe('default')

    expect(normalizeModes(sess).map((m) => m.id)).toEqual([
      'auto',
      'default',
      'acceptEdits',
      'plan',
      'dontAsk',
      'bypassPermissions',
    ])

    const options = normalizeConfigOptions(sess)
    expect(options.map((o) => o.id)).toEqual(['mode', 'model', 'effort'])

    const reasoning = deriveReasoning(options)
    expect(reasoning).toEqual({
      configId: 'effort',
      values: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultValue: 'high',
    })

    expect(deriveModelConfig(options)).toEqual({
      configId: 'model',
      values: ['default', 'sonnet', 'haiku'],
      currentValue: 'default',
    })
  })
})

describe('normalize — codex (codex-acp 0.12.0)', () => {
  test('audio=false, sse=false, 3 authMethods', async () => {
    const init = await loadInitialize('codex')
    const caps = normalizeCapabilities(init)
    expect(caps.promptCapabilities.audio).toBe(false)
    expect(caps.mcpCapabilities.sse).toBe(false)
    expect(normalizeAuthMethods(init)).toHaveLength(3)
    expect(normalizeAuthMethods(init).map((m) => m.id)).toContain('chatgpt')
  })

  test('24 models including gpt-5.5/{low,medium,high,xhigh}; reasoning_effort surface', async () => {
    const sess = await loadNewSession('codex')
    const models = normalizeModels(sess)
    expect(models.length).toBe(24)
    expect(models.map((m) => m.id)).toContain('gpt-5.5/medium')

    const reasoning = deriveReasoning(normalizeConfigOptions(sess))
    expect(reasoning).toEqual({
      configId: 'reasoning_effort',
      values: ['low', 'medium', 'high', 'xhigh'],
      defaultValue: expect.any(String),
    })
  })

  test('deriveModelConfig surfaces the 6 bare model ids — disjoint from availableModels', async () => {
    const sess = await loadNewSession('codex')
    const options = normalizeConfigOptions(sess)

    const modelConfig = deriveModelConfig(options)
    expect(modelConfig).toEqual({
      configId: 'model',
      values: [
        'gpt-5.5',
        'gpt-5.4',
        'gpt-5.4-mini',
        'gpt-5.3-codex',
        'gpt-5.3-codex-spark',
        'gpt-5.2',
      ],
      currentValue: 'gpt-5.5',
    })

    // None of the settable ids carry the `<model>/<effort>` suffix that
    // pollutes availableModels[]; this is the whole point of the field.
    expect(modelConfig?.values.every((v) => !v.includes('/'))).toBe(true)
  })
})

describe('normalize — gemini (gemini-cli 0.42.0)', () => {
  test('audio=true, configOptions empty, reasoning null', async () => {
    const init = await loadInitialize('gemini')
    const sess = await loadNewSession('gemini')

    const caps = normalizeCapabilities(init)
    expect(caps.promptCapabilities.audio).toBe(true)
    // Gemini's initialize doesn't advertise sessionCapabilities at all.
    expect(caps.sessionCapabilities.close).toBe(false)

    expect(normalizeConfigOptions(sess)).toEqual([])
    expect(deriveReasoning(normalizeConfigOptions(sess))).toBeNull()
    expect(deriveModelConfig(normalizeConfigOptions(sess))).toBeNull()
    expect(normalizeAuthMethods(init).map((m) => m.id)).toContain(
      'oauth-personal',
    )
  })
})
