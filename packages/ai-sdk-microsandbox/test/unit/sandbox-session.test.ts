import { describe, expect, test } from 'bun:test'
import type { Sandbox } from 'microsandbox'
import { bytesToStream, collectStream } from '../../src/internal/stream.ts'
import { MicrosandboxSandboxSession } from '../../src/microsandbox-sandbox-session.ts'
import { MockSandbox } from '../helpers/mock-sandbox.ts'

function newSession(mock: MockSandbox): MicrosandboxSandboxSession {
  return new MicrosandboxSandboxSession(mock as unknown as Sandbox)
}

describe('MicrosandboxSandboxSession — description', () => {
  test('contains the sandbox name', () => {
    const session = newSession(new MockSandbox({ name: 'my-vm' }))
    expect(session.description).toContain('my-vm')
  })

  test('mentions filesystem persistence', () => {
    const session = newSession(new MockSandbox())
    expect(session.description.toLowerCase()).toContain('persist')
  })
})

describe('MicrosandboxSandboxSession — run', () => {
  test('returns exitCode, stdout, and stderr', async () => {
    const mock = new MockSandbox({
      execResults: [{ code: 0, stdout: 'hello', stderr: 'warn' }],
    })
    const session = newSession(mock)
    const result = await session.run({ command: 'echo hello' })
    expect(result).toEqual({ exitCode: 0, stdout: 'hello', stderr: 'warn' })
  })

  test('passes command via bash -c', async () => {
    const mock = new MockSandbox({ execResults: [{}] })
    const session = newSession(mock)
    await session.run({ command: 'ls /tmp' })
    expect(mock.calls.execs[0]).toMatchObject({
      cmd: 'bash',
      args: ['-c', 'ls /tmp'],
    })
  })

  test('threads workingDirectory and env into the builder', async () => {
    const mock = new MockSandbox({ execResults: [{}] })
    const session = newSession(mock)
    await session.run({
      command: 'pwd',
      workingDirectory: '/work',
      env: { FOO: 'bar' },
    })
    expect(mock.calls.execs[0]).toMatchObject({
      cwd: '/work',
      env: { FOO: 'bar' },
    })
  })

  test('rejects on pre-aborted signal without calling the sandbox', async () => {
    const mock = new MockSandbox()
    const session = newSession(mock)
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(
      session.run({ command: 'echo', abortSignal: controller.signal }),
    ).rejects.toThrow('cancelled')
    expect(mock.calls.execs).toHaveLength(0)
  })
})

describe('MicrosandboxSandboxSession — spawn', () => {
  test('returns a SandboxProcess with stdout and stderr streams', async () => {
    const mock = new MockSandbox({
      execStreams: [
        {
          events: [
            { kind: 'started', pid: 99 },
            { kind: 'stdout', data: new TextEncoder().encode('out') },
            { kind: 'exited', code: 0 },
          ],
          waitCode: 0,
        },
      ],
    })
    const session = newSession(mock)
    const process = await session.spawn({ command: 'sleep 1' })
    const stdout = await collectStream(process.stdout)
    expect(new TextDecoder().decode(stdout)).toBe('out')
    expect(process.pid).toBe(99)
  })

  test('wait() returns { exitCode }', async () => {
    const mock = new MockSandbox({
      execStreams: [
        {
          events: [{ kind: 'exited', code: 7 }],
          waitCode: 7,
        },
      ],
    })
    const session = newSession(mock)
    const process = await session.spawn({ command: 'exit 7' })
    await collectStream(process.stdout)
    const result = await process.wait()
    expect(result).toEqual({ exitCode: 7 })
  })

  test('rejects on pre-aborted signal', async () => {
    const mock = new MockSandbox()
    const session = newSession(mock)
    const controller = new AbortController()
    controller.abort()
    await expect(
      session.spawn({ command: 'x', abortSignal: controller.signal }),
    ).rejects.toThrow()
    expect(mock.calls.execStreams).toHaveLength(0)
  })
})

describe('MicrosandboxSandboxSession — readBinaryFile', () => {
  test('returns bytes for an existing path', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const mock = new MockSandbox({ fsReads: new Map([['/a', bytes]]) })
    const session = newSession(mock)
    expect(await session.readBinaryFile({ path: '/a' })).toEqual(bytes)
  })

  test('returns null on ENOENT', async () => {
    const session = newSession(new MockSandbox())
    expect(await session.readBinaryFile({ path: '/missing' })).toBeNull()
  })

  test('propagates non-ENOENT errors', async () => {
    const mock = new MockSandbox()
    // Inject a custom fsRead that throws non-ENOENT
    const origRead = mock.fs.bind(mock)
    mock.fs = () => {
      const ops = origRead()
      ops.read = async () => {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      }
      return ops
    }
    const session = newSession(mock)
    await expect(session.readBinaryFile({ path: '/a' })).rejects.toThrow(
      'permission denied',
    )
  })
})

describe('MicrosandboxSandboxSession — readFile', () => {
  test('returns a ReadableStream of the file bytes', async () => {
    const bytes = new Uint8Array([0x41, 0x42])
    const mock = new MockSandbox({ fsReads: new Map([['/x', bytes]]) })
    const session = newSession(mock)
    const stream = await session.readFile({ path: '/x' })
    expect(stream).not.toBeNull()
    const collected = await collectStream(stream as ReadableStream<Uint8Array>)
    expect(collected).toEqual(bytes)
  })

  test('returns null when the file does not exist', async () => {
    const session = newSession(new MockSandbox())
    expect(await session.readFile({ path: '/missing' })).toBeNull()
  })
})

describe('MicrosandboxSandboxSession — readTextFile', () => {
  test('decodes utf-8 by default', async () => {
    const mock = new MockSandbox({
      fsReads: new Map([['/t', new TextEncoder().encode('hello')]]),
    })
    const session = newSession(mock)
    expect(await session.readTextFile({ path: '/t' })).toBe('hello')
  })

  test('applies startLine and endLine for ranged reads', async () => {
    const mock = new MockSandbox({
      fsReads: new Map([
        ['/t', new TextEncoder().encode('one\ntwo\nthree\nfour\n')],
      ]),
    })
    const session = newSession(mock)
    const slice = await session.readTextFile({
      path: '/t',
      startLine: 2,
      endLine: 3,
    })
    expect(slice).toContain('two')
    expect(slice).toContain('three')
    expect(slice).not.toContain('one')
    expect(slice).not.toContain('four')
  })

  test('returns null when the file does not exist', async () => {
    const session = newSession(new MockSandbox())
    expect(await session.readTextFile({ path: '/missing' })).toBeNull()
  })
})

describe('MicrosandboxSandboxSession — writeBinaryFile', () => {
  test('mkdirs the parent before writing nested paths', async () => {
    const mock = new MockSandbox()
    const session = newSession(mock)
    await session.writeBinaryFile({
      path: '/parent/nested/file.txt',
      content: new Uint8Array([1, 2]),
    })
    expect(mock.calls.fsMkdirs).toEqual(['/parent/nested'])
    expect(mock.calls.fsWrites).toEqual([
      { path: '/parent/nested/file.txt', size: 2 },
    ])
  })

  test('skips mkdir for root-level paths', async () => {
    const mock = new MockSandbox()
    const session = newSession(mock)
    await session.writeBinaryFile({
      path: '/file.txt',
      content: new Uint8Array([1]),
    })
    expect(mock.calls.fsMkdirs).toEqual([])
    expect(mock.calls.fsWrites).toEqual([{ path: '/file.txt', size: 1 }])
  })

  test('swallows "already exists" errors from mkdir', async () => {
    const mock = new MockSandbox({
      fsMkdirError: Object.assign(new Error('exists'), {
        code: 'AlreadyExists',
      }),
    })
    const session = newSession(mock)
    await session.writeBinaryFile({
      path: '/a/b/c.txt',
      content: new Uint8Array([1]),
    })
    expect(mock.calls.fsWrites).toEqual([{ path: '/a/b/c.txt', size: 1 }])
  })

  test('rethrows non-EEXIST mkdir errors', async () => {
    const mock = new MockSandbox({
      fsMkdirError: Object.assign(new Error('denied'), { code: 'EACCES' }),
    })
    const session = newSession(mock)
    await expect(
      session.writeBinaryFile({
        path: '/a/b/c.txt',
        content: new Uint8Array([1]),
      }),
    ).rejects.toThrow('denied')
  })
})

describe('MicrosandboxSandboxSession — writeFile (stream)', () => {
  test('collects a ReadableStream and writes its bytes', async () => {
    const mock = new MockSandbox()
    const session = newSession(mock)
    const bytes = new TextEncoder().encode('streamed')
    await session.writeFile({ path: '/s', content: bytesToStream(bytes) })
    expect(mock.calls.fsWrites).toEqual([
      { path: '/s', size: bytes.byteLength },
    ])
  })

  test('aborts mid-drain and does not call fs.write', async () => {
    const mock = new MockSandbox()
    const session = newSession(mock)
    const controller = new AbortController()
    // Stream that emits one chunk and stays open until externally cancelled.
    const content = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1, 2, 3]))
      },
    })
    queueMicrotask(() => controller.abort(new Error('upload cancelled')))
    await expect(
      session.writeFile({
        path: '/s',
        content,
        abortSignal: controller.signal,
      }),
    ).rejects.toThrow('upload cancelled')
    expect(mock.calls.fsWrites).toEqual([])
  })
})

describe('MicrosandboxSandboxSession — writeTextFile', () => {
  test('encodes utf-8 by default', async () => {
    const mock = new MockSandbox()
    const session = newSession(mock)
    await session.writeTextFile({ path: '/t', content: 'hello' })
    expect(mock.calls.fsWrites).toEqual([{ path: '/t', size: 5 }])
  })

  test('honors explicit encoding', async () => {
    const mock = new MockSandbox()
    const session = newSession(mock)
    // "h" in utf-16le is 0x68 0x00 — 2 bytes.
    await session.writeTextFile({
      path: '/t',
      content: 'h',
      encoding: 'utf16le',
    })
    expect(mock.calls.fsWrites[0]?.size).toBe(2)
  })
})
