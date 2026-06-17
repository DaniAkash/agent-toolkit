/**
 * Reject the returned promise when `signal` aborts, without changing the
 * underlying call's fate. microsandbox's SDK methods don't accept
 * `AbortSignal`, so callers can't actually cancel the in-flight work — they
 * can only stop waiting for it. This helper makes that "stop waiting"
 * semantics explicit.
 */
export function withAbort<T>(
  p: PromiseLike<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return Promise.resolve(p)
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(p).then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}
