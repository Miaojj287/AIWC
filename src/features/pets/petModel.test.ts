import { describe, expect, it } from 'vitest'
import type { InstalledPet } from '@aiwc/protocol'
import {
  bubbleFor,
  clip,
  moodFor,
  moodLoops,
  nextFlairDelay,
  REACTION_BUBBLE_MS,
  resolveCurrentPet,
  sourceLabel,
  type AgentPetSignal,
} from './petModel'
import { animationFor, cycleDuration, flairPool, frameOffset, PET_ANIMATIONS, sheetSize } from './spriteSpec'

const NOW = 1_000_000
const idle: AgentPetSignal = { threadId: 't1', streaming: false }

describe('pet mood', () => {
  it('ranks needs-you over working over a fresh reaction over idle', () => {
    const reaction = { key: 'k', outcome: 'completed' as const, message: '好了', at: NOW - 100 }
    expect(moodFor(idle, NOW)).toBe('idle')
    expect(moodFor({ ...idle, reaction }, NOW)).toBe('review')
    expect(moodFor({ ...idle, reaction: { ...reaction, outcome: 'failed' } }, NOW)).toBe('failed')
    expect(moodFor({ ...idle, reaction, streaming: true }, NOW)).toBe('running')
    expect(moodFor({ ...idle, reaction, streaming: true, approval: '发送消息给张三' }, NOW)).toBe('waiting')
  })

  it('lets a reaction expire after its window', () => {
    const at = NOW - REACTION_BUBBLE_MS.completed
    expect(moodFor({ ...idle, reaction: { key: 'k', outcome: 'completed', at: at + 1 } }, NOW)).toBe('review')
    expect(moodFor({ ...idle, reaction: { key: 'k', outcome: 'completed', at } }, NOW)).toBe('idle')
    expect(moodFor({ ...idle, reaction: { key: 'k', outcome: 'failed', at } }, NOW)).toBe('failed')
  })

  it('loops only while a state lasts', () => {
    expect(moodLoops('running')).toBe(true)
    expect(moodLoops('waiting')).toBe(true)
    expect(moodLoops('review')).toBe(false)
    expect(moodLoops('failed')).toBe(false)
  })
})

describe('pet bubble', () => {
  it('asks for confirmation with the approval summary', () => {
    expect(bubbleFor({ ...idle, approval: '发送「明天见」给 张三' }, NOW)).toEqual({
      key: 'waiting:t1:发送「明天见」给 张三',
      tone: 'waiting',
      title: '需要你确认',
      detail: '发送「明天见」给 张三',
    })
  })

  it('stays quiet while working unless a tool is running', () => {
    expect(bubbleFor({ ...idle, streaming: true }, NOW)).toBeUndefined()
    expect(bubbleFor({ ...idle, streaming: true, activity: '搜索聊天记录' }, NOW)).toMatchObject({
      tone: 'running',
      title: '正在处理',
      detail: '搜索聊天记录',
    })
  })

  it('reports a finished turn with a clipped preview', () => {
    const long = '这是一段很长的回答，'.repeat(20)
    const bubble = bubbleFor({ ...idle, reaction: { key: 'r1', outcome: 'completed', message: long, at: NOW } }, NOW)
    expect(bubble?.title).toBe('完成了')
    expect(bubble?.detail?.length).toBe(60)
    expect(bubble?.detail?.endsWith('…')).toBe(true)
    expect(
      bubbleFor({ ...idle, reaction: { key: 'r2', outcome: 'failed', message: '余额不足', at: NOW } }, NOW),
    ).toMatchObject({ key: 'failed:r2', title: '出错了', detail: '余额不足' })
    expect(bubbleFor(idle, NOW)).toBeUndefined()
  })

  it('clips whitespace-only text to nothing', () => {
    expect(clip('   \n  ')).toBeUndefined()
    expect(clip('a\n\nb')).toBe('a b')
  })
})

describe('current pet', () => {
  const pet = (id: string, builtin = false): InstalledPet => ({
    id,
    displayName: id,
    description: '',
    builtin,
    source: builtin ? 'builtin' : 'catalog',
    spriteVersion: 1,
    spriteUrl: `aiwc-media:///${id}.webp`,
  })
  const pets = [pet('aiwcji', true), pet('dewey')]

  it('prefers the selection, then a bundled pet, then anything installed', () => {
    expect(resolveCurrentPet(pets, { current: 'dewey' })?.id).toBe('dewey')
    expect(resolveCurrentPet(pets, { current: 'removed-one' })?.id).toBe('aiwcji')
    expect(resolveCurrentPet(pets, undefined)?.id).toBe('aiwcji')
    expect(resolveCurrentPet([pet('dewey')], {})?.id).toBe('dewey')
    expect(resolveCurrentPet([], { current: 'dewey' })).toBeUndefined()
  })

  it('labels where a pet came from', () => {
    expect(sourceLabel({ source: 'builtin' })).toBe('内置')
    expect(sourceLabel({ source: 'catalog', author: 'dan' })).toBe('codex-pets.net · dan')
    expect(sourceLabel({ source: 'import' })).toBe('本地导入')
  })

  it('waits 12–26 s between idle flourishes', () => {
    expect(nextFlairDelay(() => 0)).toBe(12_000)
    expect(nextFlairDelay(() => 0.999999)).toBeLessThan(26_000)
  })
})

describe('sprite spec', () => {
  it('matches the Codex app timings and sheet geometry', () => {
    expect(cycleDuration('idle')).toBe(6600)
    expect(cycleDuration('running')).toBe(820)
    expect(cycleDuration('waving')).toBe(700)
    expect(PET_ANIMATIONS.review.durations).toHaveLength(6)
    expect(frameOffset('failed', 3)).toEqual({ x: -576, y: -1040 })
    expect(frameOffset('jumping', 99)).toEqual({ x: -768, y: -832 })
    expect(sheetSize(1)).toEqual({ width: 1536, height: 1872 })
    expect(sheetSize(2)).toEqual({ width: 1536, height: 2288 })
  })

  it('only uses the look-around rows on v2 sheets', () => {
    expect(animationFor('look-left', 1)).toBe('idle')
    expect(animationFor('look-left', 2)).toBe('look-left')
    expect(flairPool(1)).toEqual(['waving', 'jumping'])
    expect(flairPool(2)).toContain('look-right')
  })
})
