/**
 * Onboarding feature. It has no workspace Tab (single-page wizard, CLAUDE.md §1); `register()` exists for
 * symmetry with the other features and the app bootstrap.
 */
export function register(): void {
  // Nothing to register: App renders <OnboardingWizard> until config.onboarding.completed.
}

export { OnboardingWizard, StepsBar, type OnboardingWizardProps } from './OnboardingWizard'
export { useWizardStore } from './wizardStore'
export { nextStepGate, validateKeyHex, type GateInput, type GateResult } from './gating'
