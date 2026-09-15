// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { applyInstallStep, initialInstallSteps, installProgress, wavingStripOffset } from './petCatalogModel'

describe('pet catalog model', () => {
  it('finds the waving frames in v1 / v2 preview strips, tolerating an extra idle frame', () => {
    expect(wavingStripOffset(7008, 2)).toBe(22) // 73 frames: 6 idle + 51 + 16 look
    expect(wavingStripOffset(7104, 2)).toBe(23) // 74 frames: 7 idle
    expect(wavingStripOffset(5472, 1)).toBe(22) // 57 frames
    expect(wavingStripOffset(960, 1)).toBeUndefined()
  })

  it('tracks install steps and progress', () => {
    let steps = initialInstallSteps()
    expect(steps.map((s) => [s.id, s.label, s.status])).toEqual([
      ['download', '下载宠物包', 'todo'],
      ['verify', '校验精灵图', 'todo'],
      ['save', '保存到本机', 'todo'],
    ])
    steps = applyInstallStep(steps, { step: 'download', status: 'done', detail: '1.8 MB' })
    steps = applyInstallStep(steps, { step: 'verify', status: 'doing' })
    expect(steps[0]).toMatchObject({ status: 'done', detail: '1.8 MB' })
    expect(steps[1]?.status).toBe('doing')
    expect(installProgress(steps)).toBe(33)
  })
})
