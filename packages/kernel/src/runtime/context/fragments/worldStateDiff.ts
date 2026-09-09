import type { ContextFragment } from '@aiwc/protocol'
import { createFragment } from './base'
import type { WorldStateSection, WorldStateSnapshot } from '../worldState'

const SECTION_LABEL: Record<WorldStateSection, string> = {
  permissions: '权限模式',
  model: '模型',
  tools: '可用工具',
  userInstructions: '用户规则',
  profile: '工具面',
}

/**
 * Only the changed sections are rendered; unchanged state is never re-sent. `userInstructions` holds a digest of
 * the rules text, which the turn loop records as its own <user_instructions> fragment — so a changed digest is
 * not rendered here (that would duplicate the rules); only "rules removed" is worth a line. A diff that leaves
 * nothing to render produces an empty body, which fragmentToItem() turns into "no item".
 */
export function worldStateDiffFragment(next: WorldStateSnapshot, changed: readonly WorldStateSection[]): ContextFragment {
  return createFragment('world_state', '<world_state>', 3000, () => {
    const lines: string[] = []
    for (const key of changed) {
      if (key === 'userInstructions') {
        if (next.userInstructions === '') lines.push(`${SECTION_LABEL[key]}：（无）`)
        continue
      }
      const value = next[key]
      const rendered = Array.isArray(value) ? (value.length ? value.join(', ') : '（无）') : String(value || '（无）')
      lines.push(`${SECTION_LABEL[key]}：${rendered}`)
    }
    if (lines.length === 0) return ''
    return ['以下环境状态自上一步以来发生了变化：', ...lines].join('\n')
  })
}
