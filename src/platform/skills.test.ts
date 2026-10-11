import { describe, expect, it } from 'vitest'
import type { SkillEntry } from '@aiwc/protocol'
import { skillArgValues, skillForPrompt, skillPromptTemplate, unfilledParams } from './skills'

const recap: SkillEntry = {
  id: 'user:recap',
  name: 'recap',
  description: '复盘',
  command: '/复盘',
  source: 'agent',
  enabled: true,
  usable: true,
  diagnostics: [],
  params: [
    { name: 'chat', required: true },
    { name: 'days', required: false, default: '7' },
  ],
  tags: [],
  size: 10,
  deletable: true,
}

describe('skill prompt helpers', () => {
  it('builds a task prompt with one slot per parameter', () => {
    expect(skillPromptTemplate(recap)).toBe('/复盘 chat= days=7')
  })
  it('finds the invoked skill by name or command, ignoring broken ones', () => {
    expect(skillForPrompt([recap], '/复盘 chat=产品群')?.id).toBe('user:recap')
    expect(skillForPrompt([recap], '/recap')?.id).toBe('user:recap')
    expect(skillForPrompt([{ ...recap, usable: false }], '/recap')).toBeUndefined()
    expect(skillForPrompt([recap], '整理一下')).toBeUndefined()
  })
  it('reads name=value pairs and reports required parameters still empty', () => {
    expect(skillArgValues('/复盘 chat=产品群 days=3')).toEqual({ chat: '产品群', days: '3' })
    expect(unfilledParams(recap, '/复盘 chat= days=7').map((p) => p.name)).toEqual(['chat'])
    expect(unfilledParams(recap, '/复盘 chat=产品群')).toEqual([])
  })
})
