import type { ContextFragment } from '@aiwc/protocol'
import { createFragment } from './base'

/** AGENTS rules supplied by the host (the memory package owns the file; the kernel only wraps the text). */
export function userInstructionsFragment(text: string, tokenCap = 4000): ContextFragment {
  return createFragment('user_instructions', '<user_instructions>', tokenCap, () => text.trim())
}
