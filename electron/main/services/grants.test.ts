import { describe, expect, it, vi } from 'vitest'
import { AppConfigSchema, type AppConfig, type ConfigPatch, type Op, type ThreadId } from '@aiwc/protocol'
import { createGrantService } from './grants'

function setup() {
  let config: AppConfig = AppConfigSchema.parse({})
  const threads = [
    {
      threadId: 'thr_a' as ThreadId,
      title: 'A',
      origin: { channel: 'desktop' },
      settings: { allowAlways: ['shell:git commit'] },
    },
    { threadId: 'thr_b' as ThreadId, title: 'B', origin: { channel: 'desktop' }, settings: { allowAlways: [] } },
    {
      threadId: 'thr_phone' as ThreadId,
      title: 'Phone',
      origin: { channel: 'wechat-remote' },
      settings: { allowAlways: ['note_write'] },
    },
    {
      threadId: 'thr_bot' as ThreadId,
      title: 'Bot',
      origin: { channel: 'wechat-ilink' },
      settings: { allowAlways: ['x'] },
    },
  ]
  const archived = [
    {
      threadId: 'thr_z' as ThreadId,
      title: 'Z',
      origin: { channel: 'desktop' },
      settings: { allowAlways: ['remember'] },
    },
  ]
  const submitted: Op[] = []
  const onChange = vi.fn()
  const service = createGrantService({
    config: {
      get: () => config,
      set: (patch: ConfigPatch) => {
        config = AppConfigSchema.parse({ ...config, agent: { ...config.agent, ...patch.agent } })
        return config
      },
    },
    kernel: {
      listThreads: async (opts) =>
        (opts.archivedOnly ? archived : threads).filter((r) => !opts.channel || r.origin.channel === opts.channel),
      submit: async (op) => void submitted.push(op),
    },
    onChange,
  })
  return { service, submitted, onChange, config: () => config }
}

describe('grant service', () => {
  it('lists global grants first, then every desktop thread’s own (archived too)', async () => {
    const { service } = setup()
    service.addGlobal('skill_manage')
    expect(await service.list()).toEqual([
      { scope: 'global', key: 'skill_manage' },
      { scope: 'thread', key: 'shell:git commit', threadId: 'thr_a', threadTitle: 'A' },
      { scope: 'thread', key: 'remember', threadId: 'thr_z', threadTitle: 'Z' },
      { scope: 'thread', key: 'note_write', threadId: 'thr_phone', threadTitle: 'Phone', phone: true },
    ])
  })

  it('adds a global grant once and ignores malformed keys', () => {
    const { service, config, onChange } = setup()
    service.addGlobal('remember')
    service.addGlobal('remember')
    service.addGlobal('Not A Key!\n')
    expect(config().agent.allowAlways).toEqual(['remember'])
    expect(onChange).toHaveBeenCalledWith('global')
  })

  it('revokes a global grant from config and a thread grant through the thread’s own settings', async () => {
    const { service, config, submitted } = setup()
    service.addGlobal('remember')
    await service.revoke({ scope: 'global', key: 'remember' })
    expect(config().agent.allowAlways).toEqual([])
    await service.revoke({ scope: 'thread', key: 'shell:git commit', threadId: 'thr_a' as ThreadId })
    expect(submitted).toEqual([{ type: 'thread.settings', threadId: 'thr_a', patch: { allowAlways: [] } }])
    await expect(service.revoke({ scope: 'thread', key: 'x', threadId: 'thr_missing' as ThreadId })).rejects.toThrow()
  })

  it('revokes a grant answered on the phone, but never touches a bot thread', async () => {
    const { service, submitted } = setup()
    await service.revoke({ scope: 'thread', key: 'note_write', threadId: 'thr_phone' as ThreadId })
    expect(submitted).toEqual([{ type: 'thread.settings', threadId: 'thr_phone', patch: { allowAlways: [] } }])
    await expect(service.revoke({ scope: 'thread', key: 'x', threadId: 'thr_bot' as ThreadId })).rejects.toThrow()
  })
})
