/**
 * Tables AIWC has pushed, newest last, in one bounded JSONL file. It is what lets "追加到上次那张表"
 * work: the record carries the vendor coordinates an append needs. Only titles, links and ids are
 * stored — never row contents.
 */
import { promises as fsp } from 'node:fs'
import { dirname } from 'node:path'
import type { OfficePushRecord } from '@aiwc/protocol'
import { isOfficePlatform } from '@aiwc/protocol'

export const HISTORY_LIMIT = 200

export interface PushHistory {
  list(limit?: number): Promise<OfficePushRecord[]>
  get(id: string): Promise<OfficePushRecord | undefined>
  append(record: OfficePushRecord): Promise<void>
}

export function createPushHistory(file: string): PushHistory {
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn)
    queue = next.catch(() => {})
    return next
  }

  const readAll = async (): Promise<OfficePushRecord[]> => {
    let text: string
    try {
      text = await fsp.readFile(file, 'utf8')
    } catch {
      return []
    }
    const out: OfficePushRecord[] = []
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line) as OfficePushRecord
        if (parsed && typeof parsed.id === 'string' && isOfficePlatform(parsed.platform)) out.push(parsed)
      } catch {
        /* a torn line from a crash — skip it */
      }
    }
    return out
  }

  return {
    list: (limit = 20) => serial(async () => (await readAll()).slice(-limit).reverse()),
    get: (id) => serial(async () => (await readAll()).find((r) => r.id === id)),
    append: (record) =>
      serial(async () => {
        await fsp.mkdir(dirname(file), { recursive: true })
        const all = [...(await readAll()), record].slice(-HISTORY_LIMIT)
        const tmp = `${file}.tmp`
        await fsp.writeFile(tmp, all.map((r) => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 })
        await fsp.rename(tmp, file)
      }),
  }
}
