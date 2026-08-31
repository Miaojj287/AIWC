import { existsSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { invalidArgument, notImplemented } from '../errors.js'
import { patchConfig } from '../config.js'
import { getPlatformNativeDir, getNativeRoot } from '../runtimePaths.js'
import { dataService } from './dataService.js'
import { resolveDbStoragePath } from './db/messageDbScanner.js'
import { readEncryptedDbSalt, scanWindowsMemoryForDbKey } from './windowsMemoryKeyScanner.js'
import type { KeyService } from './types.js'
import type { RuntimeConfig } from '../types.js'

function assertHexKey(hex: string): void {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw invalidArgument('key 必须是 64 位十六进制字符串')
  }
}

function getOpenMemoryHelperPath(): string | null {
  const override = process.env.WX_OPEN_MEMORY_HELPER_PATH
  if (override && existsSync(override)) return override

  const bundled = join(getPlatformNativeDir(), 'wechat_memory_scan_helper')
  if (existsSync(bundled)) return bundled

  const workspace = join(getNativeRoot(), '..', '..', 'resources', 'macos', 'wechat_memory_scan_helper')
  return existsSync(workspace) ? workspace : null
}

function findEncryptedDb(root: string, depth = 0): string | null {
  if (depth > 5 || !existsSync(root)) return null
  try {
    if (statSync(root).isFile()) return readEncryptedDbSalt(root) ? root : null
    const entries = readdirSync(root, { withFileTypes: true })
    const files = entries.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.db'))
    files.sort((a, b) => Number(b.name.toLowerCase() === 'session.db') - Number(a.name.toLowerCase() === 'session.db'))
    for (const entry of files) {
      const candidate = join(root, entry.name)
      if (readEncryptedDbSalt(candidate)) return candidate
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const candidate = findEncryptedDb(join(root, entry.name), depth + 1)
      if (candidate) return candidate
    }
  } catch { /* unreadable path */ }
  return null
}

export class LocalKeyService implements KeyService {
  async setKey(hex: string): Promise<{ saved: boolean; keyHex: string }> {
    assertHexKey(hex)
    patchConfig({ keyHex: hex.toLowerCase() })
    return { saved: true, keyHex: hex.toLowerCase() }
  }

  async testKey(config: RuntimeConfig): Promise<{ validFormat: boolean; connection?: { attempted: boolean; ok: boolean; sessionCount?: number; error?: string } }> {
    if (config.keyHex) assertHexKey(config.keyHex)
    const status = await dataService.getStatus(config)
    return { validFormat: Boolean(config.keyHex), connection: status.connection }
  }

  async getKey(config: RuntimeConfig, options: { save?: boolean } = {}): Promise<{ keyHex: string; saved: boolean }> {
    if (process.platform === 'darwin') {
      const openHelper = getOpenMemoryHelperPath()
      if (openHelper && config.dbPath) {
        const scanRoot = resolveDbStoragePath(config.dbPath, config.wxid || '') || config.dbPath
        const openKey = this.tryGetKeyMacOpen(openHelper, scanRoot)
        if (openKey) return this.processKeyString(openKey, options.save ?? false)
      }
      throw new Error('开源内存扫描未找到与数据库 salt 匹配的密钥；请在登录后尽快重试或手动填写密钥')
    }

    if (process.platform === 'win32') {
      const pid = this.getWeChatPid()
      if (!pid) throw new Error('微信 (Weixin.exe) 未运行。请先登录微信，然后重试。')
      if (config.dbPath) {
        const storage = resolveDbStoragePath(config.dbPath, config.wxid || '') || config.dbPath
        const encryptedDb = findEncryptedDb(storage)
        if (encryptedDb) {
          const scan = await scanWindowsMemoryForDbKey(pid, encryptedDb)
          if (scan.key) return this.processKeyString(scan.key, options.save ?? false)
        }
      }
      throw new Error('开源内存扫描未找到与数据库 salt 匹配的密钥；请在登录后尽快重试或手动填写密钥')
    }

    throw notImplemented('当前平台不支持自动获取密钥，请使用 aiwc key set <64位密钥> 手动设置')
  }

  // ══════════════════════════ macOS ══════════════════════════
  private tryGetKeyMacOpen(helperPath: string, dbPath: string): string | null {
    const pid = this.getWeChatPidMac()
    if (!pid) throw new Error('微信 (WeChat) 未运行。请先登录微信，然后重试。')

    let stdout = ''
    try {
      stdout = execFileSync(helperPath, [String(pid), dbPath], {
        encoding: 'utf8',
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
      })
    } catch (error: any) {
      stdout = typeof error?.stdout === 'string' ? error.stdout : ''
    }

    const payloadLine = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1)
    if (!payloadLine) return null
    try {
      const payload = JSON.parse(payloadLine)
      return typeof payload?.key === 'string' && /^[0-9a-fA-F]{64}$/.test(payload.key)
        ? payload.key.toLowerCase()
        : null
    } catch {
      return null
    }
  }

  private getWeChatPidMac(): number | null {
    for (const args of [['-x', 'WeChat'], ['-f', 'WeChat.app/Contents/MacOS/WeChat']]) {
      try {
        const output = execFileSync('/usr/bin/pgrep', args, { encoding: 'utf8' })
        const pids = output.split(/\r?\n/)
          .map(value => Number.parseInt(value.trim(), 10))
          .filter(value => Number.isInteger(value) && value > 0)
        if (pids.length) return Math.max(...pids)
      } catch { /* try next process matcher */ }
    }
    return null
  }

  private getWeChatPid(): number | null {
    try {
      const result = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Weixin.exe', '/FO', 'CSV', '/NH'], {
        encoding: 'utf8'
      })
      for (const line of result.trim().split('\n')) {
        if (line.toLowerCase().includes('weixin.exe')) {
          const parts = line.split(',')
          if (parts.length >= 2) {
            const pid = parseInt(parts[1].replace(/"/g, ''), 10)
            if (Number.isFinite(pid) && pid > 0) return pid
          }
        }
      }
    } catch { /* ignore */ }
    return null
  }

  private processKeyString(text: string, shouldSave: boolean): { keyHex: string; saved: boolean } {
    const cleanKey = text.replace(/[^0-9a-fA-F]/g, '').toLowerCase()
    if (cleanKey.length !== 64 || !/^[0-9a-f]{64}$/.test(cleanKey)) {
      throw new Error(`返回的密钥格式不正确 (长度 ${cleanKey.length}/64)`)
    }

    if (shouldSave) {
      patchConfig({ keyHex: cleanKey })
    }

    return { keyHex: cleanKey, saved: shouldSave }
  }

}

export const keyService = new LocalKeyService()
