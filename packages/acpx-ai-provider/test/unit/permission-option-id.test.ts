import { expect, test } from 'bun:test'
import type {
  AcpPermissionDecision,
  AcpPermissionRequest,
} from '../../src/index.ts'
import { createAcpxProvider } from '../../src/index.ts'

test('a callback may select an exact offered optionId', async () => {
  const provider = createAcpxProvider({
    agent: 'claude',
    cwd: '/tmp/t',
    onPermissionRequest: async () =>
      ({
        outcome: 'selected',
        optionId: 'opt-3',
      }) satisfies AcpPermissionDecision,
  })

  const opts = (
    provider as unknown as {
      buildRuntimeOptions: () => Record<string, unknown>
    }
  ).buildRuntimeOptions.call(provider)

  const handler = opts.onPermissionRequest as (
    req: AcpPermissionRequest,
    ctx: { signal: AbortSignal },
  ) => Promise<AcpPermissionDecision | undefined>

  expect(handler).toBeDefined()
  const decision = await handler({} as AcpPermissionRequest, {
    signal: new AbortController().signal,
  })
  expect(decision).toEqual({ outcome: 'selected', optionId: 'opt-3' })
})
