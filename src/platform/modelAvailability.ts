/**
 * Is there a model the Agent can use? The same rule as the main process's resolver: an enabled model that the
 * endpoint still offers. Drives the 先接入一个模型 call to action in an empty Agent thread and the onboarding step.
 */
import type { ProviderConfig } from '@aiwc/protocol'

export function hasUsableModel(providers: readonly Pick<ProviderConfig, 'models'>[] | undefined): boolean {
  return (providers ?? []).some((p) => p.models.some((m) => m.enabled !== false && m.available !== false))
}
