/**
 * memoryReview:* — the 待确认 list in 设置 › 记忆. Renderer input is untrusted: requests are validated with the
 * protocol schemas before anything touches the proposals file or a memory file.
 */
import { MemoryProposalAcceptRequestSchema, MemoryProposalDismissRequestSchema } from '@aiwc/protocol'
import type { AppContext } from '../contracts'
import type { Handle, HostBridge } from './register'
import { t } from '../i18n'

export function registerMemoryReviewIpc(
  ctx: Pick<AppContext, 'memoryReview'>,
  _host: HostBridge,
  handle: Handle,
): void {
  const review = ctx.memoryReview
  handle('memoryReview:list', () => review.proposals.list())
  handle('memoryReview:accept', (req) => {
    const parsed = MemoryProposalAcceptRequestSchema.safeParse(req)
    if (!parsed.success) throw new Error(t('main.memoryReview.invalidRequest'))
    return review.accept(parsed.data)
  })
  handle('memoryReview:dismiss', (req) => {
    const parsed = MemoryProposalDismissRequestSchema.safeParse(req)
    if (!parsed.success) throw new Error(t('main.memoryReview.invalidRequest'))
    return review.dismiss(parsed.data.ids)
  })
}
