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
 * - `'custom'` → `defaultDeny()` + per-host `allow.domainSuffix` rules +
 *   per-CIDR `allow.cidr` / `deny.cidr` rules. Deny rules are emitted last
 *   so first-match evaluators see them ahead of allows; action-precedence
 *   evaluators are unaffected by ordering.
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
      for (const host of policy.allowedHosts ?? []) {
        builder.rule((r) => r.any().allow((d) => d.domainSuffix(host)))
      }
      for (const cidr of policy.allowedCIDRs ?? []) {
        builder.rule((r) => r.any().allow((d) => d.cidr(cidr)))
      }
      for (const cidr of policy.deniedCIDRs ?? []) {
        builder.rule((r) => r.any().deny((d) => d.cidr(cidr)))
      }
      return builder
    }
  }
}
