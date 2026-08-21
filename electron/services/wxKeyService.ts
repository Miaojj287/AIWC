import { spawn, execSync } from 'child_process'
import { join } from 'path'
import { existsSync, readdirSync, statSync } from 'fs'
import {
  scanWindowsMemoryForDbKey,
  type WindowsMemoryKeyScanResult,
} from './windowsMemoryKeyScanner'

/** 内存扫描诊断结果 */
export interface WxScanDiag {
  key: string | null
  auth: boolean
  dbOk: boolean
  pids: number
  opened: number
  bytes: number
  markers: number
  candidates: number
}

/** 一次性从内存提取的完整账号信息（含 db_key 与明文字段） */
export interface WxAccountInfo {
  /** 64 位十六进制数据库密钥，未取到为 null */
  dbKey: string | null
  wxid: string
  /** 昵称 */
  name: string
  /** 微信号 */
  number: string
  /** 绑定手机号 */
  phone: string
  seed: number
}

export class WxKeyService {
  /**
   * 检查微信进程是否运行 (仅微信4.x Weixin.exe)
   */
  isWeChatRunning(): boolean {
    try {
      const result = execSync('tasklist /FI "IMAGENAME eq Weixin.exe" /NH', { encoding: 'utf8', windowsHide: true })
      return result.toLowerCase().includes('weixin.exe')
    } catch {
      return false
    }
  }

  /**
   * 获取微信进程 PID (仅微信4.x Weixin.exe)
   */
  getWeChatPid(): number | null {
    try {
      const result = execSync('tasklist /FI "IMAGENAME eq Weixin.exe" /FO CSV /NH', { encoding: 'utf8', windowsHide: true })
      const lines = result.trim().split('\n')

      for (const line of lines) {
        if (line.toLowerCase().includes('weixin.exe')) {
          const parts = line.split(',')
          if (parts.length >= 2) {
            const pid = parseInt(parts[1].replace(/"/g, ''), 10)
            if (!isNaN(pid)) {
              return pid
            }
          }
        }
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * 关闭微信进程 (仅微信4.x Weixin.exe)
   */
  killWeChat(): boolean {
    try {
      execSync('taskkill /F /IM Weixin.exe', { encoding: 'utf8', windowsHide: true })
      return true
    } catch {
      return false
    }
  }

  /**
   * 获取微信安装路径 (仅微信4.x Weixin.exe)
   */
  getWeChatPath(): string | null {
    // 从注册表查找
    try {
      // 查找 Uninstall 注册表
      const regPaths = [
        'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
        'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
        'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
      ]

      for (const regPath of regPaths) {
        try {
          const result = execSync(`reg query "${regPath}" /s /f "WeChat" 2>nul`, { encoding: 'utf8', windowsHide: true })
          const match = result.match(/InstallLocation\s+REG_SZ\s+(.+)/i)
          if (match) {
            const installPath = match[1].trim()
            // 只查找 Weixin.exe (微信4.x)
            const weixinPath = join(installPath, 'Weixin.exe')
            if (existsSync(weixinPath)) {
              return weixinPath
            }
          }
        } catch {
          continue
        }
      }

      // 查找 Tencent 注册表
      const tencentKeys = [
        'HKCU\\Software\\Tencent\\WeChat',
        'HKCU\\Software\\Tencent\\Weixin',
        'HKLM\\Software\\Tencent\\WeChat'
      ]

      for (const key of tencentKeys) {
        try {
          const result = execSync(`reg query "${key}" /v InstallPath 2>nul`, { encoding: 'utf8', windowsHide: true })
          const match = result.match(/InstallPath\s+REG_SZ\s+(.+)/i)
          if (match) {
            const installPath = match[1].trim()
            const weixinPath = join(installPath, 'Weixin.exe')
            if (existsSync(weixinPath)) {
              return weixinPath
            }
          }
        } catch {
          continue
        }
      }
    } catch { }

    // 常见路径 - 只查找 Weixin.exe
    const drives = ['C', 'D', 'E', 'F']
    const pathPatterns = [
      '\\Program Files\\Tencent\\WeChat\\Weixin.exe',
      '\\Program Files (x86)\\Tencent\\WeChat\\Weixin.exe'
    ]

    for (const drive of drives) {
      for (const pattern of pathPatterns) {
        const fullPath = `${drive}:${pattern}`
        if (existsSync(fullPath)) {
          return fullPath
        }
      }
    }

    return null
  }

  /**
   * 启动微信
   */
  async launchWeChat(customPath?: string): Promise<boolean> {
    const wechatPath = customPath || this.getWeChatPath()
    if (!wechatPath) {
      return false
    }

    try {
      spawn(wechatPath, [], { detached: true, stdio: 'ignore' }).unref()

      // 等待微信启动
      await new Promise(resolve => setTimeout(resolve, 2000))

      return this.isWeChatRunning()
    } catch {
      return false
    }
  }

  /**
   * 等待微信窗口出现
   */
  async waitForWeChatWindow(maxWaitSeconds = 15): Promise<boolean> {
    for (let i = 0; i < maxWaitSeconds * 2; i++) {
      await new Promise(resolve => setTimeout(resolve, 500))

      // 检查 Weixin.exe 或 WeChat.exe 进程
      const pid = this.getWeChatPid()
      if (pid !== null) {
        return true
      }
    }
    return false
  }

  /**
   * 使用本仓库的 TypeScript 内存扫描器获取数据库密钥和读取诊断。
   * @param contactDbPath contact.db 完整路径（决定校验用的 salt）
   */
  scanDbKeyDiag(contactDbPath: string): WxScanDiag | null {
    let openScan: WindowsMemoryKeyScanResult | null = null
    const pid = this.getWeChatPid()
    if (pid) {
      try {
        openScan = scanWindowsMemoryForDbKey(pid, contactDbPath)
        if (openScan.key) return openScan
      } catch (e) {
        console.warn('开源内存扫描未完成:', e)
      }
    }

    return openScan
  }

  /** 仅取密钥（诊断版的薄封装）。 */
  scanDbKey(contactDbPath: string): string | null {
    return this.scanDbKeyDiag(contactDbPath)?.key ?? null
  }

  /**
   * 旧内存结构账号扫描已移除；账号发现使用文件系统与数据库路径。
   */
  scanAccount(): WxAccountInfo | null {
    return null
  }

  /**
   * Windows 图片 AES key 开放扫描尚未实现。
   */
  scanImageAesKey(ciphertext: Buffer): string | null {
    if (!ciphertext || ciphertext.length < 16) return null
    return null
  }

  /** 释放 Rust 扫描库引用。 */
  dispose(): void {
    // no native scanner state
  }

  /**
   * 检测当前登录的微信账号
   * 通过扫描数据库目录下的账号目录，根据最近修改时间判断当前活跃账号
   * @param dbPath 数据库根路径
   * @param maxTimeDiffMinutes 最大时间差（分钟），默认5分钟
   */
  detectCurrentAccount(dbPath?: string, maxTimeDiffMinutes: number = 5): { wxid: string; dbPath: string } | null {
    try {
      if (!dbPath) {
        return null
      }

      if (!existsSync(dbPath)) {
        return null
      }

      const now = Date.now()
      const maxTimeDiffMs = maxTimeDiffMinutes * 60 * 1000
      let bestMatch: { wxid: string; dbPath: string; timeDiff: number } | null = null
      let fallbackMatch: { wxid: string; dbPath: string; timeDiff: number } | null = null

      // 遍历数据库目录下的所有账号目录
      const entries = readdirSync(dbPath, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const accountDirName = entry.name
        const accountDir = join(dbPath, accountDirName)

        // 检查是否是有效的账号目录（包含 db_storage）
        const dbStorageDir = join(accountDir, 'db_storage')
        if (!existsSync(dbStorageDir)) continue

        // 过滤掉系统目录
        if (this.isSystemDirectory(accountDirName)) continue

        // 获取账号目录的最近活动时间
        const modifiedTime = this.getAccountModifiedTime(accountDir)
        const timeDiff = Math.abs(now - modifiedTime)

        // 检查是否在时间范围内
        if (timeDiff <= maxTimeDiffMs) {
          if (!bestMatch || timeDiff < bestMatch.timeDiff) {
            bestMatch = {
              wxid: accountDirName,
              dbPath: accountDir,
              timeDiff
            }
          }
        }

        // 记录最近的账号作为备选（即使超过时间限制）
        if (!fallbackMatch || timeDiff < fallbackMatch.timeDiff) {
          fallbackMatch = {
            wxid: accountDirName,
            dbPath: accountDir,
            timeDiff
          }
        }
      }

      if (bestMatch) {
        return { wxid: bestMatch.wxid, dbPath: bestMatch.dbPath }
      }

      // 如果没有在时间范围内的账号，但有备选账号，询问用户是否使用
      if (fallbackMatch) {
        // 如果只有一个有效账号，直接使用（不管时间差）
        if (entries.filter(e => e.isDirectory() &&
          existsSync(join(dbPath, e.name, 'db_storage')) &&
          !this.isSystemDirectory(e.name)).length === 1) {
          return { wxid: fallbackMatch.wxid, dbPath: fallbackMatch.dbPath }
        }

        // 如果时间差在24小时内，自动使用这个账号
        if (fallbackMatch.timeDiff <= 24 * 60 * 60 * 1000) {
          return { wxid: fallbackMatch.wxid, dbPath: fallbackMatch.dbPath }
        }
      }

      return null
    } catch (e) {
      return null
    }
  }

  /**
   * 判断是否为系统目录
   */
  private isSystemDirectory(name: string): boolean {
    const lower = name.toLowerCase()
    const systemDirs = ['all', 'applet', 'backup', 'wmpf', 'system', 'temp', 'cache']
    return systemDirs.some(dir => lower.startsWith(dir))
  }

  /**
   * 获取账号目录的最近修改时间
   * 直接返回账号目录本身的修改时间
   */
  private getAccountModifiedTime(accountDir: string): number {
    try {
      const stats = statSync(accountDir)
      return stats.mtimeMs
    } catch {
      return 0
    }
  }
}

// 单例
export const wxKeyService = new WxKeyService()
