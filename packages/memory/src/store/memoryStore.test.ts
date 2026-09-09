import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseEntries, roundTrips, serializeEntries } from './format'
import { MemoryDriftError, createMemoryStore } from './memoryStore'
import { rankEntries } from './search'

const tmp = () => mkdtempSync(join(tmpdir(), 'aiwc-mem-'))

describe('memory file format', () => {
  it('parses § separated entries and round-trips canonical content', () => {
    const raw = 'a\n§\nb 多行\n第二行\n§\n\n c \n'
    expect(parseEntries(raw)).toEqual(['a', 'b 多行\n第二行', 'c'])
    expect(serializeEntries(['a', 'b'])).toBe('a\n§\nb\n')
    expect(roundTrips('a\n§\nb\n')).toBe(true)
    expect(roundTrips('a\n\n§\n\nb')).toBe(true) // blank lines around delimiters are tolerated
    expect(roundTrips('a\n§ 手工加的\nb')).toBe(true) // '§ x' is content, not a delimiter → still round-trips
    expect(roundTrips('§\na')).toBe(false) // leading delimiter = empty entry a rewrite would drop
    expect(roundTrips('a\n§\n  缩进开头')).toBe(false) // leading indent on an entry would be trimmed away
    expect(roundTrips('')).toBe(true)
  })
})

describe('createMemoryStore', () => {
  it('adds entries, rejects duplicates (normalised) and over-budget adds', async () => {
    const store = createMemoryStore({ dir: tmp(), limits: { MEMORY: 40 } })
    expect(await store.addEntry('MEMORY', '用户住在杭州。')).toEqual({ ok: true })
    expect(await store.addEntry('MEMORY', ' 用户住在杭州 ')).toEqual({ ok: false, reason: 'duplicate' })
    expect(await store.addEntry('MEMORY', '这是一条非常非常长的记忆，长到一定会超过四十个字符的预算限制，所以必须被拒绝掉才对')).toEqual({
      ok: false,
      reason: 'over_budget',
    })
    const entries = await store.entries('MEMORY')
    expect(entries).toHaveLength(1)
    expect(entries[0]?.source).toBe('agent')
    expect(entries[0]?.addedAt).toBeTypeOf('number')
    expect(await store.read('MEMORY')).toBe('用户住在杭州。\n')
    const b = await store.budget('MEMORY')
    expect(b).toEqual({ file: 'MEMORY', usedChars: 7, limitChars: 40 })
  })

  it('replaces / removes by index and enforces the budget on replace', async () => {
    const store = createMemoryStore({ dir: tmp(), limits: { USER: 30 } })
    await store.addEntry('USER', '喜欢咖啡', { source: 'user' })
    await store.addEntry('USER', '不喝茶')
    await store.replaceEntry('USER', 1, '偶尔喝茶')
    expect((await store.entries('USER')).map((e) => e.text)).toEqual(['喜欢咖啡', '偶尔喝茶'])
    await expect(store.replaceEntry('USER', 5, 'x')).rejects.toThrow(RangeError)
    await expect(store.replaceEntry('USER', 0, '一条长到肯定超过三十个字符预算上限的替换内容，应当抛出错误')).rejects.toThrow(/上限/)
    await store.removeEntry('USER', 0)
    expect((await store.entries('USER')).map((e) => e.text)).toEqual(['偶尔喝茶'])
  })

  it('renders a stable snapshot with usage headers for all four files', async () => {
    const store = createMemoryStore({ dir: tmp(), limits: { MEMORY: 2200 }, now: () => 1000 })
    await store.addEntry('MEMORY', '项目 A 下周一评审')
    const s1 = await store.snapshot()
    const s2 = await store.snapshot()
    expect(Object.keys(s1.files).sort()).toEqual(['AGENTS', 'MEMORY', 'SOUL', 'USER'])
    expect(s1.files.MEMORY.split('\n')[0]).toBe('[MEMORY 0% · 10/2200 字]')
    expect(s1.files.MEMORY).toContain('项目 A 下周一评审')
    expect(s1.files.SOUL).toBe('[SOUL 0% · 0/3000 字]\n（空）')
    expect(s1.files).toEqual(s2.files) // same disk state → identical render
    expect(s1.budgets.find((b) => b.file === 'USER')).toEqual({ file: 'USER', usedChars: 0, limitChars: 2500 })
  })

  it('blocks mutations and writes a .bak when the file drifted externally; adopts well-formed external edits', async () => {
    const dir = tmp()
    const store = createMemoryStore({ dir, limits: { MEMORY: 500 } })
    await store.addEntry('MEMORY', '第一条')
    // well-formed external edit (still § shaped) → adopted
    writeFileSync(join(dir, 'MEMORY.md'), '第一条\n§\n手工加的第二条\n')
    expect(await store.addEntry('MEMORY', '第三条')).toEqual({ ok: true })
    expect((await store.entries('MEMORY')).map((e) => e.text)).toEqual(['第一条', '手工加的第二条', '第三条'])
    // external edit that would not survive a rewrite (empty entries get dropped) → blocked + .bak
    writeFileSync(join(dir, 'MEMORY.md'), '第一条\n§\n§\n乱写的\n§ \n\n\n\n')
    expect(roundTrips(readFileSync(join(dir, 'MEMORY.md'), 'utf8'))).toBe(false)
    const res = await store.addEntry('MEMORY', '第四条')
    expect(res).toEqual({ ok: false, reason: 'blocked' })
    expect(readdirSync(dir).some((f) => f.startsWith('MEMORY.md.bak.'))).toBe(true)
    await expect(store.removeEntry('MEMORY', 0)).rejects.toBeInstanceOf(MemoryDriftError)
    // explicit write() from the editor is the remediation path
    await store.write('MEMORY', '重新整理\n§\n第二条')
    expect(await store.addEntry('MEMORY', '第四条')).toEqual({ ok: true })
    // an external free-form append larger than the whole budget is drift even though it "round-trips"
    writeFileSync(join(dir, 'MEMORY.md'), '重新整理\n§\n' + 'x'.repeat(600) + '\n')
    expect(await store.addEntry('MEMORY', '第五条')).toEqual({ ok: false, reason: 'blocked' })
  })

  it('replaceEntry / removeEntry reject with MemoryDriftError carrying .file and the .bak path on drift', async () => {
    const dir = tmp()
    const store = createMemoryStore({ dir, limits: { USER: 500 }, now: () => 4242 })
    await store.addEntry('USER', '第一条')
    const drifted = '第一条\n§\n§\n乱写的\n'
    writeFileSync(join(dir, 'USER.md'), drifted)
    let caught: unknown
    try {
      await store.replaceEntry('USER', 0, '改一下')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(MemoryDriftError)
    const err = caught as MemoryDriftError
    expect(err.name).toBe('MemoryDriftError')
    expect(err.file).toBe('USER')
    expect(err.bakPath).toBe(join(dir, 'USER.md.bak.4242'))
    expect(readFileSync(err.bakPath, 'utf8')).toBe(drifted)
    expect(err.message).toContain(err.bakPath)
    // the drifted file itself is untouched and removeEntry reports the same way
    expect(readFileSync(join(dir, 'USER.md'), 'utf8')).toBe(drifted)
    await expect(store.removeEntry('USER', 0)).rejects.toMatchObject({ name: 'MemoryDriftError', file: 'USER', bakPath: join(dir, 'USER.md.bak.4242') })
    // no other error shape escapes for drift: not a bare Error / RangeError
    await expect(store.removeEntry('USER', 99)).rejects.toBeInstanceOf(MemoryDriftError)
  })

  it('remembers the last written hash across restarts (no false drift after reopening)', async () => {
    const dir = tmp()
    const a = createMemoryStore({ dir, limits: { MEMORY: 100 } })
    await a.write('MEMORY', '一条通过编辑器写入、长度超过预算的内容'.repeat(6)) // over budget, but the user's explicit choice
    const b = createMemoryStore({ dir, limits: { MEMORY: 100 } })
    // hash matches what the store wrote → not drift; the add itself is refused only because of the budget
    expect(await b.addEntry('MEMORY', '新条目')).toEqual({ ok: false, reason: 'over_budget' })
    expect(readdirSync(dir).some((f) => f.includes('.bak.'))).toBe(false)
  })

  it('search scores CJK bigrams and term positions; only MEMORY/USER are searched', async () => {
    const store = createMemoryStore({ dir: tmp() })
    await store.addEntry('MEMORY', '下周三去北京出差，见客户王总')
    await store.addEntry('MEMORY', '家里的猫叫咪咪')
    await store.addEntry('USER', '用户常驻北京，偶尔去上海')
    await store.addEntry('SOUL', '北京北京北京')
    const hits = await store.search('北京出差')
    expect(hits.map((h) => h.file)).not.toContain('SOUL')
    expect(hits[0]?.file).toBe('MEMORY')
    expect(hits[0]?.entry.text).toContain('出差')
    expect(hits.some((h) => h.entry.text.includes('咪咪'))).toBe(false)
    expect(await store.search('   ')).toEqual([])
    const ranked = rankEntries(['apple pie recipe', 'I like Apple products', 'banana'], 'apple')
    expect(ranked.map((r) => r.index)).toEqual([0, 1])
  })

  it('notifies subscribers on writes with the source', async () => {
    const store = createMemoryStore({ dir: tmp() })
    const seen: Array<{ file: string; source: string | undefined }> = []
    const off = store.subscribe((e) => seen.push(e))
    await store.addEntry('MEMORY', 'a', { source: 'diary' })
    await store.write('AGENTS', '规则一', { source: 'user' })
    off()
    await store.addEntry('MEMORY', 'b')
    expect(seen).toEqual([
      { file: 'MEMORY', source: 'diary' },
      { file: 'AGENTS', source: 'user' },
    ])
  })

  it('serialises concurrent adds', async () => {
    const store = createMemoryStore({ dir: tmp() })
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.addEntry('MEMORY', `条目 ${i}`)))
    expect((await store.entries('MEMORY')).length).toBe(20)
  })
})
