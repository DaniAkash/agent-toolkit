import type { HarnessV1NetworkPolicy } from '@ai-sdk/harness'
import { NetworkPolicyBuilder } from 'microsandbox'

/**
 * Translate a harness {@link HarnessV1NetworkPolicy} into a microsandbox
 * `NetworkPolicyBuilder`. Apply the returned builder at sandbox-create time
 * via `NetworkBuilder.policyFromBuilder(builder)`. Microsandbox does not
 * support runtime policy updates, so this translation is one-shot.
 *
 * Translation:
 * - `'allow-all'` → `defaultAllow()`
 * - `'deny-all'` → `defaultDeny()`
 * - `'custom'` → `defaultDeny()` + per-CIDR `deny.cidr` rules emitted FIRST
 *   followed by per-host `allow.domainSuffix` and per-CIDR `allow.cidr`. The
 *   harness contract guarantees `deniedCIDRs` overrides allows; emitting
 *   denies first gives deny-precedence under first-match evaluators (the
 *   common case for network rule engines) while leaving action-precedence
 *   evaluators unaffected by ordering. Microsandbox's exact evaluation
 *   semantics are confirmed by integration tests against a real microVM.
 */
export function translateNetworkPolicy(
  policy: HarnessV1NetworkPolicy,
): NetworkPolicyBuilder {
  switch (policy.mode) {
    case 'allow-all':
      return new NetworkPolicyBuilder().defaultAllow()
    case 'deny-all':
      return new NetworkPolicyBuilder().defaultDeny()
    case 'custom': {
      const builder = new NetworkPolicyBuilder().defaultDeny()
      // Denies first — first-match evaluators see them ahead of allows so
      // deniedCIDRs win against overlapping allowedHosts/allowedCIDRs.
      for (const cidr of policy.deniedCIDRs ?? []) {
        builder.rule((r) => r.any().deny((d) => d.cidr(cidr)))
      }
      for (const host of policy.allowedHosts ?? []) {
        builder.rule((r) => r.any().allow((d) => d.domainSuffix(host)))
      }
      for (const cidr of policy.allowedCIDRs ?? []) {
        builder.rule((r) => r.any().allow((d) => d.cidr(cidr)))
      }
      return builder
    }
  }
}
