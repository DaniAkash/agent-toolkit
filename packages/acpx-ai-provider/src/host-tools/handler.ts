/**
 * The MCP surface for host tools, as a plain `(Request) => Response`.
 *
 * Kept free of any listener so it can be unit tested by handing it a
 * `Request`, and so the same code serves under `Bun.serve`, `node:http` or
 * anything else with a fetch-shaped adapter.
 *
 * Three methods, which is all a tool server needs: `initialize`,
 * `tools/list`, `tools/call`. The official SDK was not taken on purpose;
 * it would pull express, cors, jose, ajv and more into a package that
 * ships `dependencies: {}` and whose consumers compile to single binaries.
 *
 * Shapes here were read off a real codex-acp handshake rather than from
 * the spec alone: the client identifies as `codex-mcp-client`, proposes
 * `2025-06-18`, sends `Accept: text/event-stream, application/json`, and
 * accepts a plain JSON body for each method, so no SSE framing is needed.
 */
import type { AcpxHostTool, AcpxHostToolContext } from './types.ts'
import { formatIssues, validateToolInput } from './validate.ts'

/**
 * Protocol versions this server will speak, newest first. Pinned rather
 * than echoing the client's proposal back, so an unknown future revision
 * is answered with something we actually implement instead of a claim we
 * cannot honour.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26'] as const

export const DEFAULT_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0]

/** JSON-RPC error codes used here (spec-defined values). */
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602
const PARSE_ERROR = -32700

interface JsonRpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

export interface HostToolHandlerOptions {
  tools: Record<string, AcpxHostTool>
  /** Shared secret required on every request. */
  token: string
  serverName: string
  serverVersion: string
  sessionKey: string
  /** Aborted when the turn is cancelled; passed through to `execute`. */
  getAbortSignal: () => AbortSignal
  /** Called for each accepted `tools/call`, before `execute` runs. */
  onCall?: (toolName: string, toolCallId: string) => void
}

function ok(id: JsonRpcRequest['id'], result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id: id ?? null, result })
}

function fail(
  id: JsonRpcRequest['id'],
  code: number,
  message: string,
): Response {
  return Response.json({
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message },
  })
}

/**
 * A tool error the model should see and can react to, as distinct from a
 * protocol error. MCP models this as a normal result carrying `isError`,
 * which is why a rejected `execute` does not become a JSON-RPC error: the
 * agent is meant to read it and decide what to do, not have its turn
 * collapse.
 */
function toolError(id: JsonRpcRequest['id'], message: string): Response {
  return ok(id, {
    content: [{ type: 'text', text: message }],
    isError: true,
  })
}

function textResult(id: JsonRpcRequest['id'], value: unknown): Response {
  const text =
    typeof value === 'string'
      ? value
      : value === undefined
        ? ''
        : safeStringify(value)
  return ok(id, { content: [{ type: 'text', text }], isError: false })
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    // A tool that returns a cycle or a BigInt should not take the turn
    // down; the agent gets something it can read instead.
    return String(value)
  }
}

/**
 * Bounds how long the AGENT waits, not how long the tool runs.
 *
 * A promise cannot be cancelled from outside, so when `timeoutMs` elapses
 * the agent is answered and `tool.execute` keeps running: it may still
 * complete, perform side effects, or hold resources. The only thing that
 * reaches into a running tool is `context.abortSignal`, which carries the
 * turn's cancellation, so a tool that needs to be genuinely interruptible
 * has to honour that signal. `timeoutMs` is a response deadline.
 */
function timingOut<T>(
  promise: Promise<T>,
  ms: number | undefined,
  label: string,
): Promise<T> {
  if (ms === undefined) return promise
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} exceeded its ${ms}ms timeout`))
    }, ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

export function createHostToolHandler(
  options: HostToolHandlerOptions,
): (request: Request) => Promise<Response> {
  const dispatch = makeDispatcher(options)
  const expected = `Bearer ${options.token}`

  return async function handle(request: Request): Promise<Response> {
    // Not a constant-time comparison, and it does not need to be: the
    // token never leaves the loopback interface and is regenerated per
    // server. The check exists so a stray process on the box cannot drive
    // host code, not to resist a timing attack from one.
    if (request.headers.get('authorization') !== expected) {
      return new Response('unauthorized', { status: 401 })
    }
    if (request.method !== 'POST') {
      // No GET event stream: nothing here pushes to the client, and codex
      // does not open one. 405 says so rather than leaving it hanging.
      return new Response(null, { status: 405, headers: { allow: 'POST' } })
    }

    let body: JsonRpcRequest
    try {
      body = (await request.json()) as JsonRpcRequest
    } catch {
      return fail(null, PARSE_ERROR, 'request body was not valid JSON')
    }
    if (typeof body.method !== 'string') {
      return fail(body.id, INVALID_REQUEST, 'missing method')
    }
    // Notifications carry no id and expect no body.
    if (body.method.startsWith('notifications/')) {
      return new Response(null, { status: 202 })
    }
    return dispatch(body)
  }
}

function makeDispatcher(
  options: HostToolHandlerOptions,
): (body: JsonRpcRequest) => Promise<Response> {
  return (body) => {
    switch (body.method) {
      case 'initialize':
        return Promise.resolve(handleInitialize(body, options))
      case 'ping':
        return Promise.resolve(ok(body.id, {}))
      case 'tools/list':
        return Promise.resolve(ok(body.id, { tools: listTools(options.tools) }))
      case 'tools/call':
        return handleToolsCall(body, options)
      default:
        return Promise.resolve(
          fail(
            body.id,
            METHOD_NOT_FOUND,
            `method "${body.method}" is not supported`,
          ),
        )
    }
  }
}

function listTools(tools: Record<string, AcpxHostTool>) {
  return Object.entries(tools).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }))
}

function handleInitialize(
  body: JsonRpcRequest,
  options: HostToolHandlerOptions,
): Response {
  const proposed = body.params?.protocolVersion
  // Answer with a version we actually implement. Echoing an unknown
  // proposal back would claim conformance we have not got.
  const version =
    typeof proposed === 'string' &&
    (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(proposed)
      ? proposed
      : DEFAULT_PROTOCOL_VERSION
  return ok(body.id, {
    protocolVersion: version,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: options.serverName, version: options.serverVersion },
  })
}

async function handleToolsCall(
  body: JsonRpcRequest,
  options: HostToolHandlerOptions,
): Promise<Response> {
  const name = body.params?.name
  if (typeof name !== 'string') {
    return fail(body.id, INVALID_PARAMS, 'tools/call requires a name')
  }
  const tool = options.tools[name]
  if (!tool) {
    return fail(body.id, METHOD_NOT_FOUND, `unknown tool "${name}"`)
  }

  const rawArgs = body.params?.arguments ?? {}
  const issues = validateToolInput(rawArgs, tool.inputSchema)
  if (issues.length > 0) {
    // A tool error rather than a protocol error, on purpose: the model is
    // meant to read this and retry with the right types, which is the
    // whole point of telling it what was wrong.
    return toolError(
      body.id,
      `invalid arguments for "${name}": ${formatIssues(issues)}`,
    )
  }

  const toolCallId = String(body.id ?? name)
  options.onCall?.(name, toolCallId)

  const context: AcpxHostToolContext = {
    abortSignal: options.getAbortSignal(),
    sessionKey: options.sessionKey,
    toolCallId,
  }

  try {
    const value = await timingOut(
      Promise.resolve(
        tool.execute(rawArgs as Record<string, unknown>, context),
      ),
      tool.timeoutMs,
      `host tool "${name}"`,
    )
    return textResult(body.id, value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return toolError(body.id, `host tool "${name}" failed: ${message}`)
  }
}
