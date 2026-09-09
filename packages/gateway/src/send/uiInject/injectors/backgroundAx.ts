import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { InjectorError, type WeChatInjector } from './types'

export interface AxSelector { role: string; identifier: string }
export interface AxProfile {
  wechatVersion: string
  conversationList: AxSelector
  conversationRow: AxSelector
  header: AxSelector
  composer: AxSelector
  sendButton: AxSelector
}
export interface AxRequest {
  action: 'select' | 'fill' | 'commit'
  name: string
  text?: string
  profile: AxProfile
}
export interface AxResponse { ok: boolean; reason?: string; detail?: string; hasWritableWindowInput?: boolean; version?: string }
export interface BackgroundAxOptions {
  helperPath?: string
  profilePath?: string
  /** Test seam; production profiles come from a local, explicitly configured file. */
  profile?: AxProfile
  inspect?: () => Promise<AxResponse>
  run?: (request: AxRequest) => Promise<AxResponse>
}

function readProfile(options: BackgroundAxOptions): AxProfile {
  let candidate: unknown
  try { candidate = options.profile ?? JSON.parse(readFileSync(options.profilePath ?? '', 'utf8')) }
  catch { throw new InjectorError('unsupported', '后台回复尚未配置已验证的微信控件，未使用前台输入') }
  const keys = ['conversationList', 'conversationRow', 'header', 'composer', 'sendButton'] as const
  if (!candidate || typeof candidate !== 'object') throw new InjectorError('unsupported', '后台控件配置无效')
  if (!('wechatVersion' in candidate) || typeof candidate.wechatVersion !== 'string' || !candidate.wechatVersion.trim()) {
    throw new InjectorError('unsupported', '后台控件配置缺少微信版本')
  }
  for (const key of keys) {
    const selector = (candidate as Record<string, unknown>)[key]
    if (!selector || typeof selector !== 'object' || !('role' in selector) || !('identifier' in selector)
      || typeof selector.role !== 'string' || !selector.role.startsWith('AX')
      || typeof selector.identifier !== 'string' || !selector.identifier.trim()) {
      throw new InjectorError('unsupported', `后台控件配置无效：${key}`)
    }
  }
  return candidate as AxProfile
}

/** Helper input travels on stdin, never command-line arguments or the system clipboard. */
function runHelper(path: string | undefined, request: AxRequest | { action: 'inspect' }): Promise<AxResponse> {
  if (!path) return Promise.reject(new InjectorError('unsupported', '未配置后台回复辅助程序'))
  return new Promise((resolve, reject) => {
    const child = spawn(path, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    const timer = setTimeout(() => { child.kill(); reject(new InjectorError('unsupported', '后台操作超时，已停止')) }, 12_000)
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
      if (output.length > 64_000) { child.kill(); reject(new InjectorError('unsupported', '后台操作返回异常')) }
    })
    child.stderr.resume()
    child.stdin.on('error', () => { /* exit/error below reports a closed helper */ })
    child.on('error', () => { clearTimeout(timer); reject(new InjectorError('unsupported', '后台回复辅助程序不可用')) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) return reject(new InjectorError('unsupported', '后台回复辅助程序退出异常'))
      try {
        const result: unknown = JSON.parse(output)
        if (!result || typeof result !== 'object' || !('ok' in result) || typeof result.ok !== 'boolean') throw new Error('invalid')
        resolve(result as AxResponse)
      } catch { reject(new InjectorError('unsupported', '后台操作返回无效结果')) }
    })
    child.stdin.end(JSON.stringify(request))
  })
}

/** Background-only backend: no import of the foreground injector and no fallback to global input. */
export function createBackgroundAxInjector(options: BackgroundAxOptions = {}): WeChatInjector {
  let name: string | undefined
  let text: string | undefined
  let profile: AxProfile | undefined
  const inspect = options.inspect ?? (() => runHelper(options.helperPath, { action: 'inspect' }))
  const run = options.run ?? ((request: AxRequest) => runHelper(options.helperPath, request))
  async function call(action: AxRequest['action'], target: string, content?: string): Promise<void> {
    profile ??= readProfile(options)
    const result = await run({ action, name: target, text: content, profile })
    if (!result.ok) {
      // Never retry a possibly completed write. Only selection may be retried as busy.
      const reason = result.reason === 'no-permission' || result.reason === 'no-window' ? result.reason
        : result.reason === 'busy' && action === 'select' ? 'busy' : 'unsupported'
      throw new InjectorError(reason, result.detail ?? '后台操作失败，未使用前台输入')
    }
  }
  return {
    retryCommit: false,
    detailedErrors: true,
    async focusSession(target) {
      name = undefined
      text = undefined
      if (!target.trim()) throw new InjectorError('unsupported', '缺少目标会话')
      const capability = await inspect()
      if (!capability.ok) throw new InjectorError(capability.reason === 'no-permission' ? 'no-permission' : 'unsupported', capability.detail ?? '无法检查后台回复能力')
      if (capability.hasWritableWindowInput !== true) {
        throw new InjectorError('unsupported', `微信 ${capability.version ?? ''} 未暴露可后台写入的聊天控件，静默发送不可用；已停止，未唤起微信`)
      }
      await call('select', target)
      name = target
    },
    async fill(content) {
      text = undefined
      if (!name || !content) throw new InjectorError('unsupported', '未确认目标会话或文本为空')
      await call('fill', name, content)
      text = content
    },
    async commit() {
      if (!name || !text) throw new InjectorError('unsupported', '未确认待发送的草稿')
      await call('commit', name, text)
    },
  }
}
