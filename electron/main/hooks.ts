/**
 * Host hooks registered on the kernel's HookRunner.
 *  - dateHook: UserPromptSubmit → appends today's date so the model never guesses it.
 *  - memoryToastHook: PostToolUse(remember) → right-bottom toast (CLAUDE.md §4.6 / DESIGN-SPEC §2 记忆).
 */
import type { ToastPayload } from '@aiwc/protocol'
import type { Hook } from '@aiwc/kernel'

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const
const pad = (n: number) => String(n).padStart(2, '0')

export function formatChineseDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}（${WEEKDAYS[d.getDay()]}）`
}

export function dateHook(clock: () => Date = () => new Date()): Hook {
  return {
    name: 'host.date',
    events: ['UserPromptSubmit'],
    async run() {
      return { additionalContext: `当前日期：${formatChineseDate(clock())}` }
    },
  }
}

/** Tool names whose successful completion means memory was written. */
export const MEMORY_WRITE_TOOLS: readonly string[] = ['remember']

function outputLooksLikeError(output: unknown): boolean {
  if (!output || typeof output !== 'object') return false
  const o = output as { isError?: unknown; ok?: unknown }
  return o.isError === true || o.ok === false
}

export function memoryToastHook(toast: (payload: ToastPayload) => void): Hook {
  return {
    name: 'host.memoryToast',
    events: ['PostToolUse'],
    async run(_event, payload) {
      if (!payload.toolName || !MEMORY_WRITE_TOOLS.includes(payload.toolName)) return
      if (outputLooksLikeError(payload.output)) return
      toast({
        id: 'memory.written',
        kind: 'success',
        text: 'Agent 已写入记忆',
        action: { label: '查看', command: 'tab.openSettings' },
      })
    },
  }
}
