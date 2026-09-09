import type { ContextFragment, TurnAbortedItem } from '@aiwc/protocol'
import { createFragment } from './base'

const REASON_LABEL: Record<TurnAbortedItem['reason'], string> = {
  interrupted: '用户中断了上一轮',
  replaced: '上一轮被新的输入替代',
  error: '上一轮因错误中止',
  step_cap: '上一轮达到步数上限而中止',
  loop_guard: '上一轮因重复调用同一工具被终止',
  timeout: '上一轮超时',
}

/** Tells the model why the previous turn ended abruptly so it does not assume its tool calls completed. */
export function turnAbortedFragment(reason: TurnAbortedItem['reason']): ContextFragment {
  return createFragment('turn_aborted', '<turn_aborted>', 200, () => `${REASON_LABEL[reason]}；未完成的工具调用不应视为已执行。`)
}
