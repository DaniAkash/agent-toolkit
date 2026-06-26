import type { AcpRuntimeOptions } from 'acpx/runtime'
import type { AcpxBridgeMcpServer } from '../acpx-bridge-protocol.ts'

export type RuntimeMcpServer = NonNullable<
  AcpRuntimeOptions['mcpServers']
>[number]

/**
 * Convert the bridge's wire-shape MCP server list (Records for env/headers,
 * optional args) into the ACP SDK shape acpx expects (Array of `{ name, value }`
 * entries, required `args`).
 */
export function toRuntimeMcpServers(
  servers: ReadonlyArray<AcpxBridgeMcpServer> | undefined,
): RuntimeMcpServer[] | undefined {
  if (!servers || servers.length === 0) return undefined
  return servers.map(toRuntimeMcpServer)
}

function toRuntimeMcpServer(server: AcpxBridgeMcpServer): RuntimeMcpServer {
  if (server.type === 'stdio') {
    return {
      name: server.name,
      command: server.command,
      args: server.args ?? [],
      env: recordToEntries(server.env),
    }
  }
  return {
    type: server.type,
    name: server.name,
    url: server.url,
    headers: recordToEntries(server.headers),
  }
}

function recordToEntries(
  record: Record<string, string> | undefined,
): Array<{ name: string; value: string }> {
  if (!record) return []
  return Object.entries(record).map(([name, value]) => ({ name, value }))
}
