import { posix } from 'node:path'
import type {
  Experimental_SandboxProcess,
  Experimental_SandboxSession,
} from '@ai-sdk/provider-utils'
import { extractLines } from '@ai-sdk/provider-utils'
import type { Sandbox } from 'microsandbox'
import { withAbort } from './abort.ts'
import { isDirectoryExistsError, isFileNotFoundError } from './errors.ts'
import { bytesToStream, collectStream } from './internal/stream.ts'
import { createSandboxProcess } from './process-adapter.ts'

/**
 * `Experimental_SandboxSession` implementation backed by a microsandbox
 * `Sandbox`. Wraps the eight filesystem and exec methods that the AI SDK
 * harness needs; does not implement the network sandbox surface (id, ports,
 * getPortUrl, etc.) — that's the responsibility of
 * `MicrosandboxNetworkSandboxSession` which extends this class.
 */
export class MicrosandboxSandboxSession implements Experimental_SandboxSession {
  constructor(protected readonly sandbox: Sandbox) {}

  get description(): string {
    return [
      `microsandbox VM (name: ${this.sandbox.name}).`,
      'Filesystem changes persist for the lifetime of the sandbox.',
    ].join('\n')
  }

  async run({
    command,
    workingDirectory,
    env,
    abortSignal,
  }: {
    command: string
    workingDirectory?: string
    env?: Record<string, string>
    abortSignal?: AbortSignal
  }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    abortSignal?.throwIfAborted()
    const output = await withAbort(
      this.sandbox.execWith('bash', (b) => {
        let builder = b.args(['-c', command])
        if (workingDirectory !== undefined)
          builder = builder.cwd(workingDirectory)
        if (env !== undefined) builder = builder.envs(env)
        return builder
      }),
      abortSignal,
    )
    return {
      exitCode: output.code,
      stdout: output.stdout(),
      stderr: output.stderr(),
    }
  }

  async spawn({
    command,
    workingDirectory,
    env,
    abortSignal,
  }: {
    command: string
    workingDirectory?: string
    env?: Record<string, string>
    abortSignal?: AbortSignal
  }): Promise<Experimental_SandboxProcess> {
    abortSignal?.throwIfAborted()
    const handle = await this.sandbox.execStreamWith('bash', (b) => {
      let builder = b.args(['-c', command])
      if (workingDirectory !== undefined)
        builder = builder.cwd(workingDirectory)
      if (env !== undefined) builder = builder.envs(env)
      return builder
    })
    return createSandboxProcess(handle, abortSignal)
  }

  async readFile({
    path,
    abortSignal,
  }: {
    path: string
    abortSignal?: AbortSignal
  }): Promise<ReadableStream<Uint8Array> | null> {
    const bytes = await this.readBinaryFile({ path, abortSignal })
    if (bytes == null) return null
    return bytesToStream(bytes)
  }

  async readBinaryFile({
    path,
    abortSignal,
  }: {
    path: string
    abortSignal?: AbortSignal
  }): Promise<Uint8Array | null> {
    abortSignal?.throwIfAborted()
    try {
      return await withAbort(this.sandbox.fs().read(path), abortSignal)
    } catch (error) {
      if (isFileNotFoundError(error)) return null
      throw error
    }
  }

  async readTextFile({
    path,
    encoding = 'utf-8',
    startLine,
    endLine,
    abortSignal,
  }: {
    path: string
    encoding?: string
    startLine?: number
    endLine?: number
    abortSignal?: AbortSignal
  }): Promise<string | null> {
    const bytes = await this.readBinaryFile({ path, abortSignal })
    if (bytes == null) return null
    const text = Buffer.from(bytes).toString(encoding as BufferEncoding)
    return extractLines({ text, startLine, endLine })
  }

  async writeFile({
    path,
    content,
    abortSignal,
  }: {
    path: string
    content: ReadableStream<Uint8Array>
    abortSignal?: AbortSignal
  }): Promise<void> {
    const bytes = await collectStream(content)
    await this.writeBinaryFile({ path, content: bytes, abortSignal })
  }

  async writeBinaryFile({
    path,
    content,
    abortSignal,
  }: {
    path: string
    content: Uint8Array
    abortSignal?: AbortSignal
  }): Promise<void> {
    abortSignal?.throwIfAborted()
    const parent = posix.dirname(path)
    if (parent && parent !== '.' && parent !== '/') {
      try {
        await withAbort(this.sandbox.fs().mkdir(parent), abortSignal)
      } catch (error) {
        if (!isDirectoryExistsError(error)) throw error
      }
    }
    await withAbort(this.sandbox.fs().write(path, content), abortSignal)
  }

  async writeTextFile({
    path,
    content,
    encoding = 'utf-8',
    abortSignal,
  }: {
    path: string
    content: string
    encoding?: string
    abortSignal?: AbortSignal
  }): Promise<void> {
    const buffer = Buffer.from(content, encoding as BufferEncoding)
    const bytes = new Uint8Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    )
    await this.writeBinaryFile({ path, content: bytes, abortSignal })
  }
}
