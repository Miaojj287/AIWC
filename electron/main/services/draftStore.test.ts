import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ComposerDraftRecord } from '@aiwc/protocol'
import { boundDrafts, createDraftStore, draftRecordSchema, MAX_DRAFTS, type DraftEntry } from './draftStore'

const dirs: string[] = []
const tempFile = () => {
  const dir = mkdtempSync(join(tmpdir(), 'aiwc-drafts-'))
  dirs.push(dir)
  return join(dir, 'drafts.json')
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const draft = (text: string, attachments: ComposerDraftRecord['attachments'] = []): ComposerDraftRecord => ({
  text,
  mentions: [],
  attachments,
})

describe('draft store', () => {
  it('persists drafts across instances and forgets cleared ones', async () => {
    const file = tempFile()
    let clock = 1
    const store = createDraftStore({ file, now: () => clock++ })
    await store.save('thr_a', draft('hello'))
    await store.save('new', draft('unsent new thread'))
    await store.save('thr_b', draft('to be cleared'))
    await store.save('thr_b', null)
    await store.flush()

    const reopened = createDraftStore({ file })
    const loaded = await reopened.load()
    expect(loaded.map((e) => [e.key, e.draft.text])).toEqual([
      ['new', 'unsent new thread'],
      ['thr_a', 'hello'],
    ])
    // an empty draft counts as cleared
    await reopened.save('thr_a', draft('  '))
    await reopened.flush()
    expect((await createDraftStore({ file }).load()).map((e) => e.key)).toEqual(['new'])
  })

  it('starts empty on a corrupt file instead of failing', async () => {
    const file = tempFile()
    writeFileSync(file, '{not json')
    expect(await createDraftStore({ file }).load()).toEqual([])
    writeFileSync(file, JSON.stringify({ version: 1, drafts: [{ key: 1 }] }))
    expect(await createDraftStore({ file }).load()).toEqual([])
  })

  it('bounds count and size: attachments of the oldest drafts go first', () => {
    const image = { id: 'a1', part: { type: 'image' as const, mediaType: 'image/png', data: 'A'.repeat(4000) } }
    const entries: DraftEntry[] = Array.from({ length: MAX_DRAFTS + 5 }, (_, i) => ({
      key: `thr_${i}`,
      draft: draft(`d${i}`, [image]),
      updatedAt: i,
    }))
    expect(boundDrafts(entries)).toHaveLength(MAX_DRAFTS)
    const tight = boundDrafts(entries.slice(0, 3), 9_000)
    expect(tight[0]?.draft.attachments).toHaveLength(1) // newest keeps its image
    expect(tight.at(-1)?.draft.attachments).toHaveLength(0)
  })

  it('validates renderer drafts', () => {
    expect(draftRecordSchema.safeParse(draft('ok')).success).toBe(true)
    expect(draftRecordSchema.safeParse({ ...draft('x'), extra: 1 }).success).toBe(false)
    const tooMany = Array.from({ length: 9 }, (_, i) => ({
      id: `a${i}`,
      part: { type: 'image' as const, mediaType: 'image/png', data: 'AAAA' },
    }))
    expect(draftRecordSchema.safeParse(draft('x', tooMany)).success).toBe(false)
  })

  it('writes atomically (no partial file)', async () => {
    const file = tempFile()
    const store = createDraftStore({ file })
    await store.save('k', draft('x'))
    await store.flush()
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ version: 1 })
  })
})
