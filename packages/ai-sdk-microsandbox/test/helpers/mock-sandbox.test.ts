import { describe, expect, test } from 'bun:test'
import { MockSandbox } from './mock-sandbox.ts'

describe('MockSandbox — runtime behaviour', () => {
  test('default name is "mock-sandbox" and is configurable', () => {
    expect(new MockSandbox().name).toBe('mock-sandbox')
    expect(new MockSandbox({ name: 'custom' }).name).toBe('custom')
  })

  test('fs().read returns canned bytes for known paths', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const sandbox = new MockSandbox({
      fsReads: new Map([['/data', bytes]]),
    })
    expect(await sandbox.fs().read('/data')).toEqual(bytes)
  })

  test('fs().read throws a NotFound error for unknown paths', async () => {
    const sandbox = new MockSandbox()
    await expect(sandbox.fs().read('/missing')).rejects.toMatchObject({
      code: 'NotFound',
    })
  })

  test('fs().read throws a NotFound error for paths mapped to undefined', async () => {
    const sandbox = new MockSandbox({
      fsReads: new Map([['/explicit-missing', undefined]]),
    })
    await expect(sandbox.fs().read('/explicit-missing')).rejects.toMatchObject({
      code: 'NotFound',
    })
  })

  test('fs().write records calls with byte sizes', async () => {
    const sandbox = new MockSandbox()
    await sandbox.fs().write('/a', new Uint8Array([1, 2, 3]))
    await sandbox.fs().write('/b', 'hello')
    expect(sandbox.calls.fsWrites).toEqual([
      { path: '/a', size: 3 },
      { path: '/b', size: 5 },
    ])
  })

  test('fs().mkdir records calls', async () => {
    const sandbox = new MockSandbox()
    await sandbox.fs().mkdir('/parent')
    await sandbox.fs().mkdir('/parent/nested')
    expect(sandbox.calls.fsMkdirs).toEqual(['/parent', '/parent/nested'])
  })

  test('fs().mkdir throws the configured error', async () => {
    const sandbox = new MockSandbox({
      fsMkdirError: Object.assign(new Error('exists'), {
        code: 'AlreadyExists',
      }),
    })
    await expect(sandbox.fs().mkdir('/p')).rejects.toMatchObject({
      code: 'AlreadyExists',
    })
  })

  test('execWith dispenses canned outputs in FIFO order', async () => {
    const sandbox = new MockSandbox({
      execResults: [
        { code: 0, stdout: 'first', stderr: '' },
        { code: 1, stdout: '', stderr: 'second' },
      ],
    })
    const first = await sandbox.execWith('bash', (b) =>
      b.args(['-c', 'echo first']),
    )
    expect(first.code).toBe(0)
    expect(first.stdout()).toBe('first')
    const second = await sandbox.execWith('bash', (b) =>
      b.args(['-c', 'echo second']),
    )
    expect(second.code).toBe(1)
    expect(second.stderr()).toBe('second')
  })

  test('execWith records command, args, cwd, env', async () => {
    const sandbox = new MockSandbox()
    await sandbox.execWith('bash', (b) =>
      b.args(['-c', 'ls']).cwd('/work').envs({ FOO: 'bar' }),
    )
    expect(sandbox.calls.execs).toEqual([
      { cmd: 'bash', args: ['-c', 'ls'], cwd: '/work', env: { FOO: 'bar' } },
    ])
  })

  test('execStreamWith yields scripted events and reports pid', async () => {
    const sandbox = new MockSandbox({
      execStreams: [
        {
          events: [
            { kind: 'started', pid: 42 },
            { kind: 'stdout', data: new Uint8Array([0x61]) },
            { kind: 'exited', code: 0 },
          ],
          waitCode: 0,
        },
      ],
    })
    const handle = await sandbox.execStreamWith('bash', (b) =>
      b.args(['-c', 'x']),
    )
    expect(handle.pid).toBe(42)
    const events = []
    for await (const event of handle) events.push(event)
    expect(events).toHaveLength(3)
    expect(events[1]).toEqual({ kind: 'stdout', data: new Uint8Array([0x61]) })
    const result = await handle.wait()
    expect(result.code).toBe(0)
  })

  test('execStreamWith handle.kill records call count', async () => {
    const sandbox = new MockSandbox({
      execStreams: [{}],
    })
    const handle = await sandbox.execStreamWith('bash', (b) =>
      b.args(['-c', 'x']),
    )
    await handle.kill()
    await handle.kill()
    expect(handle.killCalls).toBe(2)
  })

  test('config() returns the configured object', async () => {
    const sandbox = new MockSandbox({
      config: { workdir: '/workspace', cpus: 2 },
    })
    expect(await sandbox.config()).toEqual({ workdir: '/workspace', cpus: 2 })
  })

  test('config() returns an empty object by default', async () => {
    const sandbox = new MockSandbox()
    expect(await sandbox.config()).toEqual({})
  })

  test('stop() records call count and throws when configured', async () => {
    const sandbox = new MockSandbox()
    await sandbox.stop()
    expect(sandbox.stopCalls).toBe(1)
    const failing = new MockSandbox({ stopError: new Error('stop failed') })
    await expect(failing.stop()).rejects.toThrow('stop failed')
  })
})
