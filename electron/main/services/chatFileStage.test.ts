import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WxMedia } from '@aiwc/protocol'
import { createAllowList } from '../security/pathAllowList'
import { safeFileName, stageChatFile, type ChatFileStageDeps } from './chatFileStage'

vi.mock('../i18n', () => ({ t: (key: string) => key }))

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() ?? '', { recursive: true, force: true })
})

function setup(media: WxMedia | undefined) {
  const root = mkdtempSync(join(tmpdir(), 'aiwc-stage-'))
  dirs.push(root)
  const wechat = join(root, 'xwechat_files')
  const cache = join(root, 'data', 'cache')
  mkdirSync(join(wechat, 'wxid_me', 'msg', 'file'), { recursive: true })
  mkdirSync(cache, { recursive: true })
  const allowList = createAllowList([cache], { home: join(root, 'home') })
  const deps: ChatFileStageDeps = {
    resolveMedia: vi.fn(async () => media),
    accountRoot: () => wechat,
    stageDir: join(cache, 'previews'),
    isAllowed: (p) => allowList.isAllowed(p),
  }
  return { root, wechat, cache, deps, allowList }
}

describe('stageChatFile', () => {
  it('copies the attachment into the allow-listed preview cache and reuses the copy', async () => {
    const ctx = setup(undefined)
    const source = join(ctx.wechat, 'wxid_me', 'msg', 'file', '2026-10', '周报.pdf')
    mkdirSync(dirname(source), { recursive: true })
    writeFileSync(source, 'pdf-bytes')
    ctx.deps.resolveMedia = vi.fn(async () => ({ kind: 'file', path: source, fileName: '周报.pdf' }) as WxMedia)
    const first = await stageChatFile(ctx.deps, 's1', 'm1')
    expect(first.fileName).toBe('周报.pdf')
    expect(ctx.allowList.isAllowed(first.path)).toBe(true)
    expect(readFileSync(first.path, 'utf8')).toBe('pdf-bytes')
    const second = await stageChatFile(ctx.deps, 's1', 'm1')
    expect(second.path).toBe(first.path)
  })

  it('refuses an attachment outside the WeChat data root (e.g. through a symlink)', async () => {
    const ctx = setup(undefined)
    const secret = join(ctx.root, 'secret.txt')
    writeFileSync(secret, 'x')
    const link = join(ctx.wechat, 'wxid_me', 'msg', 'file', 'link.txt')
    symlinkSync(secret, link)
    ctx.deps.resolveMedia = vi.fn(async () => ({ kind: 'file', path: link }) as WxMedia)
    await expect(stageChatFile(ctx.deps, 's', 'm')).rejects.toThrow('main.data.chatFileOutside')
  })

  it('reports a file that never reached this computer', async () => {
    const ctx = setup({ kind: 'file', fileName: 'a.pdf' } as WxMedia)
    await expect(stageChatFile(ctx.deps, 's', 'm')).rejects.toThrow('main.data.chatFileMissing')
  })

  it('makes names safe', () => {
    expect(safeFileName('../a/b:c?.pdf')).toBe('_a_b_c_.pdf')
    expect(safeFileName('...')).toBe('file')
    expect(safeFileName(`${'长'.repeat(200)}.docx`).endsWith('.docx')).toBe(true)
  })
})
