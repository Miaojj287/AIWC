import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { changedFiles, MAX_ARTIFACTS_PER_CALL, SNAPSHOT_MAX_ENTRIES, snapshotWorkspace } from './workspaceChanges'

let dir: string | undefined
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})
const workspace = () => (dir = mkdtempSync(join(tmpdir(), 'aiwc-ws-')))

describe('changedFiles', () => {
  it('reports previewable files a command created or changed, and nothing else', () => {
    const ws = workspace()
    writeFileSync(join(ws, '旧.md'), 'a')
    writeFileSync(join(ws, 'same.csv'), 'x,y')
    const before = snapshotWorkspace(ws)
    writeFileSync(join(ws, '旧.md'), 'changed text')
    mkdirSync(join(ws, 'out'))
    writeFileSync(join(ws, 'out', '周报.xlsx'), 'bin')
    writeFileSync(join(ws, 'build.log.tmp'), 'noise')
    writeFileSync(join(ws, '~$周报.xlsx'), 'lock')
    writeFileSync(join(ws, '.hidden.md'), 'dot')
    writeFileSync(join(ws, 'script.py'), 'print(1)')
    mkdirSync(join(ws, 'node_modules'))
    writeFileSync(join(ws, 'node_modules', 'readme.md'), 'dep')
    const files = changedFiles(before, snapshotWorkspace(ws))
    expect(files.map((f) => f.title).sort()).toEqual(['周报.xlsx', '旧.md'])
    expect(files.find((f) => f.title === '旧.md')).toMatchObject({ kind: 'file', mediaType: 'text/markdown' })
  })

  it('notices a rewrite with the same size by its modification time', () => {
    const ws = workspace()
    const path = join(ws, 'a.md')
    writeFileSync(path, 'aaaa')
    utimesSync(path, new Date(1_000_000), new Date(1_000_000))
    const before = snapshotWorkspace(ws)
    writeFileSync(path, 'bbbb')
    utimesSync(path, new Date(2_000_000), new Date(2_000_000))
    expect(changedFiles(before, snapshotWorkspace(ws)).map((f) => f.title)).toEqual(['a.md'])
  })

  it('caps the cards per call and gives up on a workspace too large to walk', () => {
    const ws = workspace()
    const before = snapshotWorkspace(ws)
    for (let i = 0; i < MAX_ARTIFACTS_PER_CALL + 4; i++) writeFileSync(join(ws, `${i}.md`), String(i))
    expect(changedFiles(before, snapshotWorkspace(ws))).toHaveLength(MAX_ARTIFACTS_PER_CALL)
    expect(changedFiles(undefined, snapshotWorkspace(ws))).toEqual([])
    for (let i = 0; i < SNAPSHOT_MAX_ENTRIES + 5; i++) writeFileSync(join(ws, `f${i}.txt`), '')
    expect(snapshotWorkspace(ws)).toBeUndefined()
  })
})
