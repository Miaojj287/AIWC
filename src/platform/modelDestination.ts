/**
 * Where a feature's model calls go, for its one-sentence data-destination note (CLAUDE.md §6): the
 * chosen model when it is still configured and enabled, else the default model, else nothing — how
 * the main process resolves an optional per-feature model (设置 › 每日待办 today).
 */
import type { InvokeRes, ModelSelection } from '@aiwc/protocol'

type ModelOption = InvokeRes<'agent:listModels'>[number]

export type ModelDestination =
  { kind: 'local'; model: string } | { kind: 'online'; model: string; provider: string } | { kind: 'none' }

const same = (m: ModelOption, s: ModelSelection) => m.providerId === s.providerId && m.modelId === s.modelId

export function modelDestination(
  models: readonly ModelOption[],
  selection: ModelSelection | undefined,
  fallback: ModelSelection | undefined,
): ModelDestination {
  const chosen =
    (selection && models.find((m) => same(m, selection))) ?? (fallback && models.find((m) => same(m, fallback)))
  if (!chosen) return { kind: 'none' }
  if (chosen.local) return { kind: 'local', model: chosen.label }
  return { kind: 'online', model: chosen.label, provider: chosen.providerLabel || chosen.providerId }
}
