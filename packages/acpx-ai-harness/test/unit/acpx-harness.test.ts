import { describe, expect, test } from 'bun:test'
import { HARNESS_V1_BUILTIN_TOOL_NAMES } from '@ai-sdk/harness'
import { ACPX_BUILTIN_TOOLS } from '../../src/acpx-builtin-tools.ts'
import { acpxHarness, createAcpxHarness } from '../../src/acpx-harness.ts'
import {
  acpxBridgeCoordsSchema,
  acpxLifecycleStateSchema,
} from '../../src/acpx-lifecycle.ts'
import {
  type AcpxPermissionMode,
  harnessPermissionModeToAcpx,
} from '../../src/acpx-permission.ts'

describe('acpxHarness object shape', () => {
  test('declares the harness-v1 spec version', () => {
    expect(acpxHarness.specificationVersion).toBe('harness-v1')
  })

  test("harnessId is the kebab-case slug 'acpx'", () => {
    expect(acpxHarness.harnessId).toBe('acpx')
  })

  test('advertises built-in tool approval support', () => {
    expect(acpxHarness.supportsBuiltinToolApprovals).toBe(true)
  })

  test('exposes a lifecycleStateSchema', () => {
    expect(acpxHarness.lifecycleStateSchema).toBeDefined()
  })

  test('createAcpxHarness produces an equivalent shape', () => {
    const fresh = createAcpxHarness({ agent: 'claude' })
    expect(fresh.specificationVersion).toBe('harness-v1')
    expect(fresh.harnessId).toBe('acpx')
  })
})

describe('ACPX_BUILTIN_TOOLS', () => {
  test('covers every standard common-tool name', () => {
    for (const name of HARNESS_V1_BUILTIN_TOOL_NAMES) {
      expect(ACPX_BUILTIN_TOOLS).toHaveProperty(name)
    }
  })

  test('every entry tags its toolUseKind', () => {
    for (const [, tool] of Object.entries(ACPX_BUILTIN_TOOLS)) {
      expect(tool.toolUseKind).toBeDefined()
    }
  })

  test('bash is the only `bash`-kind tool', () => {
    const bashKind = Object.entries(ACPX_BUILTIN_TOOLS).filter(
      ([, t]) => t.toolUseKind === 'bash',
    )
    expect(bashKind.map(([k]) => k)).toEqual(['bash'])
  })
})

describe('harnessPermissionModeToAcpx', () => {
  const cases: Array<{
    input: Parameters<typeof harnessPermissionModeToAcpx>[0]
    expected: AcpxPermissionMode
  }> = [
    { input: 'allow-all', expected: 'approve-all' },
    { input: 'allow-edits', expected: 'approve-all' },
    { input: 'allow-reads', expected: 'approve-reads' },
    { input: undefined, expected: 'approve-all' },
  ]

  for (const { input, expected } of cases) {
    test(`${String(input)} -> ${expected}`, () => {
      expect(harnessPermissionModeToAcpx(input)).toBe(expected)
    })
  }
})

describe('acpxLifecycleStateSchema', () => {
  test('parses a state with bridge coordinates', () => {
    const parsed = acpxLifecycleStateSchema.parse({
      bridge: { port: 4001, token: 'tok', lastSeenEventId: 7 },
      sessionKey: 'agent-x-session-1',
    })
    expect(parsed.bridge?.port).toBe(4001)
    expect(parsed.sessionKey).toBe('agent-x-session-1')
  })

  test('parses an empty state', () => {
    expect(acpxLifecycleStateSchema.parse({})).toEqual({})
  })

  test('preserves unknown fields under passthrough', () => {
    const parsed = acpxLifecycleStateSchema.parse({ extra: 'opaque' })
    expect((parsed as Record<string, unknown>).extra).toBe('opaque')
  })

  test('rejects bridge coords missing required fields', () => {
    expect(() => acpxBridgeCoordsSchema.parse({ port: 1 })).toThrow()
  })
})

describe('doStart placeholder', () => {
  test('throws a descriptive not-implemented error', async () => {
    await expect(
      acpxHarness.doStart({
        sessionId: 's',
        sessionWorkDir: '/tmp/x',
        // biome-ignore lint/suspicious/noExplicitAny: placeholder call shape
      } as any),
    ).rejects.toThrow(/not implemented/i)
  })
})

describe('getBootstrap recipe', () => {
  const PKG = '{"name":"acpx-ai-harness-bridge","version":"0.0.0"}'
  const BUNDLE = 'console.log("bridge bundle stub")'

  function buildWithFakeAssets() {
    const reads: string[] = []
    const harness = createAcpxHarness({
      readBridgeAsset: async (name) => {
        reads.push(name)
        if (name === 'package.json') return PKG
        if (name === 'index.js') return BUNDLE
        throw new Error(`unexpected asset: ${name}`)
      },
    })
    return { harness, reads }
  }

  test('declares the acpx harnessId on the recipe', async () => {
    const { harness } = buildWithFakeAssets()
    const recipe = await harness.getBootstrap?.()
    expect(recipe?.harnessId).toBe('acpx')
  })

  test('uses an ephemeral bootstrap directory under /tmp', async () => {
    const { harness } = buildWithFakeAssets()
    const recipe = await harness.getBootstrap?.()
    expect(recipe?.bootstrapDir).toBe('/tmp/harness/acpx')
  })

  test('lays down the bridge manifest + bundle under the bootstrap dir', async () => {
    const { harness } = buildWithFakeAssets()
    const recipe = await harness.getBootstrap?.()
    expect(recipe?.files).toEqual([
      { path: '/tmp/harness/acpx/package.json', content: PKG },
      { path: '/tmp/harness/acpx/bridge.mjs', content: BUNDLE },
    ])
  })

  test('runs install via pnpm with a local store dir', async () => {
    const { harness } = buildWithFakeAssets()
    const recipe = await harness.getBootstrap?.()
    const installCmd = recipe?.commands.find((c) => c.command.includes('pnpm'))
    expect(installCmd?.command).toContain('pnpm')
    expect(installCmd?.command).toContain('/tmp/harness/acpx')
    expect(installCmd?.command).toContain('--store-dir')
  })

  test('runs `acpx --version` as the post-install smoke check', async () => {
    const { harness } = buildWithFakeAssets()
    const recipe = await harness.getBootstrap?.()
    const lastCmd = recipe?.commands.at(-1)?.command
    expect(lastCmd).toContain('acpx --version')
  })

  test('reads each asset only once across repeated getBootstrap calls', async () => {
    const { harness, reads } = buildWithFakeAssets()
    await harness.getBootstrap?.()
    await harness.getBootstrap?.()
    await harness.getBootstrap?.()
    expect(reads).toEqual(['package.json', 'index.js'])
  })

  test('default reader is wired when no override is supplied', () => {
    const harness = createAcpxHarness()
    expect(typeof harness.getBootstrap).toBe('function')
  })
})
