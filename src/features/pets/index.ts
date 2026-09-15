/**
 * AI 宠物 (Codex Pets) — sprite rendering, the pet state model and the Agent-panel companion.
 * The settings page lives in features/settings (设置 › 宠物); the agent feature computes the signal.
 */
export { AgentPet, perchInset, PERCH_OVERLAP } from './AgentPet'
export { hidePet, openPetSettings } from './actions'
export { PetSprite } from './PetSprite'
export { resolveCurrentPet, sourceLabel, type AgentPetSignal, type PetReaction } from './petModel'
export { usePetStore, useInstalledPets, useCurrentPet, __resetPetStoreForTests } from './petStore'
export { animationFor, type PetAnimationId } from './spriteSpec'
export { usePrefersReducedMotion, useSpriteFrame } from './useSpriteFrame'
