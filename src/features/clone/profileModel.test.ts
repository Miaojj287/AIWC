import { describe, expect, it } from 'vitest'
import type { PersonaCard, PersonaSample } from '@aiwc/protocol'
import { addTag, appendSample, cardWithTags, deleteImpactText, profileMeta, removeAt, removeHabit, replaceSample, setHabit } from './profileModel'

describe('profileModel', () => {
  it('adds tags with validation and removes by index', () => {
    expect(addTag(['亲切'], ' 简短 ')).toEqual({ list: ['亲切', '简短'] })
    expect(addTag(['亲切'], '亲切').error).toBe('「亲切」已存在')
    expect(addTag([], '  ').error).toBe('内容不能为空')
    expect(addTag([], 'x'.repeat(21)).error).toBe('不超过 20 个字')
    expect(removeAt(['a', 'b', 'c'], 1)).toEqual(['a', 'c'])
  })
  it('edits habits as KV', () => {
    const h = setHabit({ 平均长度: '1–2 句' }, '常见回复时段', ' 21:00–24:00 ')
    expect(h).toEqual({ 平均长度: '1–2 句', 常见回复时段: '21:00–24:00' })
    expect(setHabit(h, '  ', 'x')).toEqual(h)
    expect(removeHabit(h, '平均长度')).toEqual({ 常见回复时段: '21:00–24:00' })
  })
  it('replaces / appends samples marking them corrected', () => {
    const samples: PersonaSample[] = [{ prompt: 'p', reply: 'r' }]
    expect(replaceSample(samples, 0, ' 新回复 ', 9)).toEqual([{ prompt: 'p', reply: '新回复', at: 9, corrected: true }])
    expect(replaceSample(samples, 0, '  ', 9)).toEqual(samples)
    expect(appendSample(samples, '', '安啦～', 5)[1]).toEqual({ prompt: '（手动补充）', reply: '安啦～', at: 5, corrected: true })
  })
  it('builds card patches and header meta', () => {
    const card: PersonaCard = { tone: ['直接'], traits: [], catchphrases: [], punctuation: '', addressing: {}, topics: [], replyHabits: {} }
    expect(cardWithTags(card, 'catchphrases', ['行']).catchphrases).toEqual(['行'])
    expect(profileMeta({ samples: [{ prompt: 'a', reply: 'b' }], version: 3 }, { state: 'ready', version: 2, sampleCount: 1, builtAt: 0 }, 'hy3')).toBe('v2 · 1 个样本 · 模型 hy3')
    expect(profileMeta({ samples: [], version: 1 }, undefined)).toBe('v1 · 0 个样本')
    expect(deleteImpactText()).toMatch(/不可恢复/)
  })
})
