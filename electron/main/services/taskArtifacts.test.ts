import { describe, expect, it } from 'vitest'
import { MAX_RUN_ARTIFACTS, runArtifacts } from './taskArtifacts'

describe('runArtifacts', () => {
  it('keeps files by path, newest last, without duplicates or inline content', () => {
    expect(
      runArtifacts([
        { kind: 'file', title: '日报.md', path: '/ws/日报.md' },
        { kind: 'markdown', title: '草稿', content: '# 不是文件' },
        { kind: 'image', title: '图.png', path: '/ws/图.png' },
        { kind: 'file', title: '日报.md', path: '/ws/日报.md' },
      ]),
    ).toEqual([
      { title: '图.png', path: '/ws/图.png' },
      { title: '日报.md', path: '/ws/日报.md' },
    ])
    expect(runArtifacts([])).toBeUndefined()
  })

  it('caps how many a run keeps', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      kind: 'file' as const,
      title: `${i}.md`,
      path: `/ws/${i}.md`,
    }))
    const kept = runArtifacts(many)
    expect(kept).toHaveLength(MAX_RUN_ARTIFACTS)
    expect(kept?.at(-1)?.path).toBe('/ws/29.md')
  })
})
