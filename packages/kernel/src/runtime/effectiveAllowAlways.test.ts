import { describe, expect, it } from 'vitest'
import type { ThreadSettings } from '@aiwc/protocol'
import { effectiveAllowAlways } from './effectiveAllowAlways'

const settings = (profile: ThreadSettings['profile'], allowAlways: string[] = []): ThreadSettings => ({
  permissionMode: 'ask',
  profile,
  allowAlways,
})

describe('effectiveAllowAlways', () => {
  it('adds global grants to desktop threads without duplicates', () => {
    expect(
      effectiveAllowAlways(settings('desktop-chat', ['shell:git status']), ['remember', 'shell:git status'], 'desktop'),
    ).toEqual(['shell:git status', 'remember'])
  })

  it('never widens a scheduled task or a bot thread with global grants', () => {
    expect(effectiveAllowAlways(settings('cron', ['remember']), ['shell:git commit'], 'cron')).toEqual(['remember'])
    expect(effectiveAllowAlways(settings('wechat-bot'), ['send_message'], 'wechat-ilink')).toEqual([])
  })

  it('keeps desktop grants off the phone thread, which runs the desktop toolset', () => {
    expect(
      effectiveAllowAlways(settings('desktop-chat', ['shell:git status']), ['shell:git commit'], 'wechat-remote'),
    ).toEqual(['shell:git status'])
  })
})
