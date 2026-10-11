/**
 * Whether a configured model accepts image input. The model entry's `supportsVision` is the answer: 智能配置 fills
 * it from the model's capabilities (API metadata or the profile table, applyModelProfile) when the model is added,
 * and the user's 图片 toggle in the model's settings overrides it either way — explicit off means no images even for
 * an image-capable model. Shared by the request adapter (images to a model that cannot see them become a text note)
 * and the composer (which says so before sending).
 */
import type { ModelEntry, ProviderConfig } from './config'

export function modelSupportsVision(
  _provider: Pick<ProviderConfig, 'kind'>,
  model: Pick<ModelEntry, 'modelId' | 'supportsVision'>,
): boolean {
  return model.supportsVision === true
}
