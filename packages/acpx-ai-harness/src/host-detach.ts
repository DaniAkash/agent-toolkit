import type { AcpxChannel } from './sandbox-channel.ts'

/**
 * Send `detach` to the bridge and wait for the `bridge-detach` reply that
 * carries the adapter-defined payload. Falls back to an empty object after
 * a short timeout so a wedged bridge can't block doStop indefinitely, and
 * short-circuits if the channel is already closed.
 */
export async function requestDetachPayload(
  channel: AcpxChannel,
  timeoutMs = 5_000,
): Promise<unknown> {
  if (channel.isClosed()) return {}
  return new Promise<unknown>((resolve) => {
    const timer = setTimeout(() => {
      unsub()
      resolve({})
    }, timeoutMs)
    const unsub = channel.on('bridge-detach', (msg) => {
      clearTimeout(timer)
      unsub()
      resolve(msg.data ?? {})
    })
    try {
      channel.send({ type: 'detach' })
    } catch {
      clearTimeout(timer)
      unsub()
      resolve({})
    }
  })
}
