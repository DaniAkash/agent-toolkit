import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { AgentResolveError, probeAgent } from '../../src/index.ts'

const FAKE_AGENT = fileURLToPath(
  new URL('../helpers/fake-agent.ts', import.meta.url),
)
const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url))

describe('probeAgent — error paths', () => {
  test('spawn_failed when the binary does not exist', async () => {
    const result = await probeAgent({
      command: '/definitely/not/a/real/binary --acp',
      timeoutMs: 5_000,
    })
    expect(result.error?.code).toBe('spawn_failed')
    expect(result.agent.argv[0]).toBe('/definitely/not/a/real/binary')
  })

  test('initialize_timeout when the agent never replies to initialize', async () => {
    const result = await probeAgent({
      argv: ['bun', 'run', FAKE_AGENT],
      env: {
        FAKE_INITIALIZE_FIXTURE: `${FIXTURES_DIR}claude-initialize.json`,
        FAKE_HANG_ON: 'initialize',
      },
      timeoutMs: 1_500,
    })
    expect(result.error?.code).toBe('initialize_timeout')
  })

  test('session_new_timeout when the agent never replies to session/new', async () => {
    const result = await probeAgent({
      argv: ['bun', 'run', FAKE_AGENT],
      env: {
        FAKE_INITIALIZE_FIXTURE: `${FIXTURES_DIR}claude-initialize.json`,
        FAKE_NEWSESSION_FIXTURE: `${FIXTURES_DIR}claude-newsession.json`,
        FAKE_HANG_ON: 'session/new',
      },
      timeoutMs: 1_500,
    })
    expect(result.error?.code).toBe('session_new_timeout')
  })

  test('agent_crashed when the agent exits before initialize', async () => {
    const result = await probeAgent({
      argv: ['bun', 'run', FAKE_AGENT],
      env: {
        FAKE_INITIALIZE_FIXTURE: `${FIXTURES_DIR}claude-initialize.json`,
        FAKE_EXIT_BEFORE: 'initialize',
      },
      timeoutMs: 5_000,
    })
    expect(result.error?.code).toBe('agent_crashed')
  })
})

describe('probeAgent — { agent } resolution errors', () => {
  test('unknown agent id throws AgentResolveError with cause unknown_agent', async () => {
    let thrown: unknown = null
    try {
      await probeAgent({ agent: 'absolutely-not-a-real-agent-9001' })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(AgentResolveError)
    expect((thrown as AgentResolveError).resolveCause).toBe('unknown_agent')
  })
})
