import { expect, test } from 'bun:test'
import type { AcpPermissionDecision } from '../../src/index.ts'
import { createAcpxProvider } from '../../src/index.ts'

test('a callback may select an exact offered optionId', () => {
  const decision: AcpPermissionDecision = {
    outcome: 'selected',
    optionId: 'opt-3',
  }
  const provider = createAcpxProvider({
    agent: 'claude',
    cwd: '/tmp/t',
    onPermissionRequest: () => decision,
  })
  const opts = (
    provider as unknown as {
      buildRuntimeOptions: () => Record<string, unknown>
    }
  ).buildRuntimeOptions.call(provider)
  const handler = opts.onPermissionRequest as () => AcpPermissionDecision
  expect(handler()).toEqual({ outcome: 'selected', optionId: 'opt-3' })
})
