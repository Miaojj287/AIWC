/** memoryReview:* — the 待确认 list, localStorage-backed; accepting appends a `- ` line through the memory mock. */
import type { MemoryProposal } from '@aiwc/protocol'
import type { HandlersFor, Handlers, MockContext } from './core'

const KEY = 'aiwc.mock.memoryReview'

type MemoryWriter = Pick<Handlers, 'memory:read' | 'memory:write' | 'memory:entries'>

export function memoryReviewHandlers(ctx: MockContext, deps: { memory: MemoryWriter }): HandlersFor<'memoryReview'> {
  const list = (): MemoryProposal[] => ctx.kv.get<MemoryProposal[]>(KEY, [])
  const save = (items: MemoryProposal[]) => {
    ctx.kv.set(KEY, items)
    ctx.emit('memoryReview:changed', { items: [...items].sort((a, b) => b.createdAt - a.createdAt) })
  }

  return {
    'memoryReview:list': () => [...list()].sort((a, b) => b.createdAt - a.createdAt),
    'memoryReview:accept': async ({ id, text, file }) => {
      const proposal = list().find((p) => p.id === id)
      if (!proposal) return { ok: false, reason: 'not_found' }
      const target = file ?? proposal.file
      const body = (text ?? proposal.text).trim()
      const entries = await deps.memory['memory:entries']({ file: target })
      const done = () => save(list().filter((p) => p.id !== id))
      if (entries.some((e) => e.text === body)) {
        done()
        return { ok: false, reason: 'duplicate' }
      }
      const current = await deps.memory['memory:read']({ file: target })
      await deps.memory['memory:write']({ file: target, markdown: `${current.trimEnd()}\n- ${body}\n` })
      done()
      return { ok: true }
    },
    'memoryReview:dismiss': ({ ids }) => {
      const drop = new Set(ids)
      save(list().filter((p) => !drop.has(p.id)))
    },
  }
}
