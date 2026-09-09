import { describe, it, expect } from 'vitest'
import { createWcdbSourceReader } from '../wcdb'
import { createMirror } from '../mirror'
import { createSubstrateFacade } from '.'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const KEY = process.env.AIWC_TEST_KEY || ''
const ROOT = process.env.AIWC_TEST_ROOT || ''
const WXID = process.env.AIWC_TEST_WXID || ''
const NATIVE = process.env.AIWC_TEST_NATIVE || ''
const run = KEY && ROOT && WXID ? describe : describe.skip

run('full substrate path (reader → mirror → facade → sync)', () => {
  it('syncs real data and serves it through the facade the UI uses', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiwc-facade-'))
    const reader = createWcdbSourceReader({ nativeDir: NATIVE })
    const mirror = createMirror({ dbPath: join(dir, 'mirror.db') })
    const facade = createSubstrateFacade({ source: reader, mirror, cacheDir: join(dir, 'cache') })
    await facade.openWith({ dbRoot: ROOT, wxid: WXID, dbKeyHex: KEY, cacheDir: join(dir, 'cache') })
    const sync = await facade.sync({ full: false })
    console.log('SYNC:', JSON.stringify(sync.totals ?? {}), 'phase:', sync.phase)
    const sessions = await facade.listSessions({ limit: 5, kind: 'all' })
    console.log('FACADE sessions total:', sessions.total, 'returned:', sessions.items.length)
    console.log(JSON.stringify(sessions.items.slice(0, 4).map(s => ({ kind: s.kind, title: s.title, preview: (s.lastPreview||'').slice(0,24), unread: s.unread })), null, 1))
    const first = sessions.items.find(s => s.kind === 'dm') ?? sessions.items[0]
    if (first) {
      const msgs = await facade.listMessages({ sessionId: first.id, limit: 5 })
      console.log('FACADE messages for', first.title, '->', msgs.items.length)
      // FTS search over the mirror
      const hits = await facade.search({ query: (msgs.items[0]?.text || '你好').slice(0, 2), limit: 3, mode: 'keyword' })
      console.log('FACADE search hits:', hits.length, hits.slice(0,2).map(h => (h.snippet||'').slice(0,30)))
    }
    await facade.close()
    expect(sessions.total).toBeGreaterThan(0)
  }, 120_000)
})
