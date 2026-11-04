/**
 * Binds a host tool handler to a loopback port.
 *
 * The only part of this feature that needs a runtime-specific API, which
 * is why it is the only part separated from `handler.ts`: serving needs a
 * listener, and `fetch` is a client. Bun first, then `node:http` by
 * dynamic import so the Node path costs nothing on Bun and nothing is
 * imported statically that a worker runtime would choke on.
 */
import { createHostToolHandler } from './handler.ts'
import type { AcpxHostTool } from './types.ts'

export interface HostToolServer {
  url: string
  token: string
  serverName: string
  port: number
  close: () => Promise<void>
}

export interface StartHostToolServerOptions {
  tools: Record<string, AcpxHostTool>
  serverName: string
  serverVersion: string
  sessionKey: string
  hostname?: string
  getAbortSignal: () => AbortSignal
  onCall?: (toolName: string, toolCallId: string) => void
}

interface BunGlobal {
  serve: (opts: {
    port: number
    hostname: string
    fetch: (request: Request) => Promise<Response>
  }) => { port: number; stop: (closeActive?: boolean) => void }
}

function bunRuntime(): BunGlobal | undefined {
  const candidate = (globalThis as { Bun?: BunGlobal }).Bun
  return typeof candidate?.serve === 'function' ? candidate : undefined
}

function randomToken(): string {
  // `randomUUID` is on WebCrypto in Bun, Node 19+ and workerd alike.
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return uuid.replaceAll('-', '')
  // Only reachable on a runtime without WebCrypto, where the loopback
  // token is the lesser problem; still not sequential.
  let out = ''
  for (let i = 0; i < 4; i++) out += Math.random().toString(36).slice(2, 10)
  return out
}

export async function startHostToolServer(
  options: StartHostToolServerOptions,
): Promise<HostToolServer> {
  const hostname = options.hostname ?? '127.0.0.1'
  const token = randomToken()
  const handler = createHostToolHandler({
    tools: options.tools,
    token,
    serverName: options.serverName,
    serverVersion: options.serverVersion,
    sessionKey: options.sessionKey,
    getAbortSignal: options.getAbortSignal,
    onCall: options.onCall,
  })

  const bun = bunRuntime()
  if (bun) {
    const server = bun.serve({ port: 0, hostname, fetch: handler })
    return {
      url: `http://${hostname}:${server.port}/mcp`,
      token,
      serverName: options.serverName,
      port: server.port,
      close: async () => {
        server.stop(true)
      },
    }
  }

  return await startNodeServer(handler, hostname, token, options.serverName)
}

function headersFromNode(
  nodeHeaders: Record<string, string | string[] | undefined>,
): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (typeof value === 'string') headers.set(key, value)
    else if (Array.isArray(value)) headers.set(key, value.join(','))
  }
  return headers
}

function readBody(req: import('node:http').IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function writeResponse(
  res: import('node:http').ServerResponse,
  response: Response,
): Promise<void> {
  const text = await response.text()
  const out: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    out[key] = value
  })
  res.writeHead(response.status, out)
  res.end(text)
}

function nodeListener(
  handler: (request: Request) => Promise<Response>,
  hostname: string,
): import('node:http').RequestListener {
  return (req, res) => {
    void (async () => {
      try {
        const body = await readBody(req)
        const hasBody =
          body.length > 0 && req.method !== 'GET' && req.method !== 'HEAD'
        const request = new Request(`http://${hostname}${req.url ?? '/'}`, {
          method: req.method,
          headers: headersFromNode(req.headers),
          // Decoded rather than passed as a Buffer: every MCP body here
          // is JSON text, and a Node Buffer is not a valid BodyInit.
          ...(hasBody ? { body: body.toString('utf8') } : {}),
        })
        await writeResponse(res, await handler(request))
      } catch (error) {
        res.writeHead(500, { 'content-type': 'text/plain' })
        res.end(String(error))
      }
    })()
  }
}

async function startNodeServer(
  handler: (request: Request) => Promise<Response>,
  hostname: string,
  token: string,
  serverName: string,
): Promise<HostToolServer> {
  let http: typeof import('node:http')
  try {
    http = await import('node:http')
  } catch {
    throw new Error(
      'host tools need either Bun.serve or node:http to bind a loopback MCP ' +
        'server; this runtime has neither. Pass the tools as a pre-existing ' +
        'MCP server through `mcpServers` instead.',
    )
  }

  const server = http.createServer(nodeListener(handler, hostname))
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, hostname, () => {
      const address = server.address()
      if (address && typeof address === 'object') resolve(address.port)
      else reject(new Error('could not determine the bound port'))
    })
  })

  return {
    url: `http://${hostname}:${port}/mcp`,
    token,
    serverName,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}
