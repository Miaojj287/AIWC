import { describe, expect, it } from 'vitest'
import type { ScheduledTask } from '@aiwc/protocol'
import { taskRunInput } from './tasks'

const task = (prompt: string): ScheduledTask =>
  ({ id: 't1', name: '周报', prompt, createdAt: 0, updatedAt: 0 }) as unknown as ScheduledTask

describe('taskRunInput', () => {
  it('wraps an ordinary prompt after the unattended-run rules', () => {
    const input = taskRunInput(task('整理今天的消息'), new Date(2026, 9, 11, 8, 30))
    expect(input.content).toHaveLength(1)
    const first = input.content[0]!
    expect(first.type === 'text' && first.text.startsWith('【定时任务「周报」')).toBe(true)
    expect(first.type === 'text' && first.text.endsWith('整理今天的消息')).toBe(true)
  })

  it('puts a /skill prompt first so the kernel loads the skill, with the rules as a second part', () => {
    const input = taskRunInput(task('  /周报 产品群 '), new Date(2026, 9, 11, 8, 30))
    expect(input.content).toHaveLength(2)
    expect(input.content[0]).toEqual({ type: 'text', text: '/周报 产品群' })
    const rules = input.content[1]!
    expect(rules.type === 'text' && rules.text.includes('无人值守')).toBe(true)
  })
})
