import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createWeChatVideoAccess, isWeChatVideoFile } from './wechatVideoAccess'

const root = '/data/xwechat_files/wxid_abc'

describe('isWeChatVideoFile', () => {
  it('allows clips and poster frames under msg/video only', () => {
    expect(isWeChatVideoFile(`${root}/msg/video/2026-09/abc.mp4`, root)).toBe(true)
    expect(isWeChatVideoFile(`${root}/msg/video/2026-09/abc_thumb.jpg`, root)).toBe(true)
    expect(isWeChatVideoFile(`${root}/msg/file/2026-09/report.mp4`, root)).toBe(false)
    expect(isWeChatVideoFile(`${root}/db_storage/message/message_0.db`, root)).toBe(false)
    expect(isWeChatVideoFile(`${root}/msg/video/2026-09/notes.txt`, root)).toBe(false)
    // the folder itself, or a file named like it directly under msg, is not a clip inside it
    expect(isWeChatVideoFile(`${root}/msg/video.mp4`, root)).toBe(false)
  })

  it('refuses escapes, relative paths, NUL and a root that would open the whole disk', () => {
    expect(isWeChatVideoFile(`${root}/msg/video/../../db_storage/x.jpg`, root)).toBe(false)
    expect(isWeChatVideoFile('/elsewhere/msg/video/a.mp4', root)).toBe(false)
    expect(isWeChatVideoFile('msg/video/a.mp4', root)).toBe(false)
    expect(isWeChatVideoFile(`${root}/msg/video/a\0.mp4`, root)).toBe(false)
    expect(isWeChatVideoFile('/msg/video/a.mp4', '/')).toBe(false)
  })
})

describe('createWeChatVideoAccess', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('follows the configured root, also in its resolved (symlink-free) form', () => {
    // resolved up front: the temp folder itself sits behind a symlink on macOS (/var → /private/var)
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'aiwc-video-')))
    const real = join(dir, 'real')
    mkdirSync(join(real, 'msg', 'video', '2026-09'), { recursive: true })
    writeFileSync(join(real, 'msg', 'video', '2026-09', 'a.mp4'), '')
    const link = join(dir, 'link')
    symlinkSync(real, link)
    let configured: string | undefined = link
    const allows = createWeChatVideoAccess(() => configured)
    expect(allows(join(link, 'msg', 'video', '2026-09', 'a.mp4'))).toBe(true)
    expect(allows(join(real, 'msg', 'video', '2026-09', 'a.mp4'))).toBe(true)
    configured = undefined
    expect(allows(join(real, 'msg', 'video', '2026-09', 'a.mp4'))).toBe(false)
  })
})
