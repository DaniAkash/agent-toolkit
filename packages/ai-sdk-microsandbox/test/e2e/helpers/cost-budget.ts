/**
 * Assert a generate() result stayed within a small per-test budget. Cheap
 * insurance against a test prompt accidentally producing a 10000-token
 * response. Skips silently if usage isn't reported by the model.
 */
export function assertWithinBudget(
  usage: { inputTokens?: number; outputTokens?: number } | undefined,
  budget: { input?: number; output?: number } = {},
): void {
  if (!usage) return
  const inputCap = budget.input ?? 20_000
  const outputCap = budget.output ?? 2_000
  if (typeof usage.inputTokens === 'number' && usage.inputTokens > inputCap) {
    throw new Error(
      `e2e input budget exceeded: ${usage.inputTokens} > ${inputCap}`,
    )
  }
  if (
    typeof usage.outputTokens === 'number' &&
    usage.outputTokens > outputCap
  ) {
    throw new Error(
      `e2e output budget exceeded: ${usage.outputTokens} > ${outputCap}`,
    )
  }
}
