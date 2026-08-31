import { app } from 'electron'
import { basename, dirname, join } from 'path'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { execFile, execSync, spawn } from 'child_process'
import { promisify } from 'util'
import crypto from 'crypto'
import { homedir } from 'os'
import { scanMacosMemoryForDbKey } from './macosMemoryKeyScanner'
import { DB_PAGE_SIZE, parseLldbKeyBytes, validateRawDbKey } from './macosLldbKeyCapture'

const execFileAsync = promisify(execFile)
const MAC_KEY_DEBUG = process.env.AIWC_MAC_KEY_DEBUG === '1'

function logMacKey(level: 'log' | 'warn' | 'error', ...args: any[]): void {
  if (!MAC_KEY_DEBUG) return
  console[level](...args)
}

type DbKeyResult = {
  success: boolean
  key?: string
  error?: string
  logs?: string[]
}

type ImageKeyResult = {
  success: boolean
  xorKey?: number
  aesKey?: string
  error?: string
}

export class WxKeyServiceMac {
  private koffi: any = null
  private lib: any = null
  private initialized = false
  private GetDbKey: any = null
  private ListWeChatProcesses: any = null
  private libSystem: any = null
  private machTaskSelf: any = null
  private taskForPid: any = null
  private machVmRegion: any = null
  private machVmReadOverwrite: any = null
  private machPortDeallocate: any = null
  private needsElevation = false

  private getResourceDirs(): string[] {
    if (app.isPackaged) {
      return [
        join(process.resourcesPath, 'resources', 'macos'),
        join(process.resourcesPath, 'macos')
      ]
    }

    return [
      join(app.getAppPath(), 'resources', 'macos'),
      join(process.cwd(), 'resources', 'macos')
    ]
  }

  private resolveResource(name: string): string {
    for (const dir of this.getResourceDirs()) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }

    throw new Error(`${name} not found`)
  }

  private getOpenMemoryScanHelperPath(): string {
    if (process.env.WX_OPEN_MEMORY_HELPER_PATH && existsSync(process.env.WX_OPEN_MEMORY_HELPER_PATH)) {
      return process.env.WX_OPEN_MEMORY_HELPER_PATH
    }
    return this.resolveResource('wechat_memory_scan_helper')
  }

  async initialize(): Promise<boolean> {
    return true
  }

  async checkSipStatus(): Promise<{ enabled: boolean; error?: string }> {
    try {
      const { stdout } = await execFileAsync('/usr/bin/csrutil', ['status'])
      return { enabled: stdout.toLowerCase().includes('enabled') }
    } catch (e: any) {
      return { enabled: false, error: e.message }
    }
  }

  isWeChatRunning(): boolean {
    return this.getWeChatPid() !== null
  }

  getWeChatPid(): number | null {
    try {
      const exact = execSync('/usr/bin/pgrep -x WeChat', { encoding: 'utf8' })
      const ids = exact.split(/\r?\n/).map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n) && n > 0)
      if (ids.length > 0) return Math.max(...ids)
    } catch {
      // ignore
    }

    try {
      const fuzzy = execSync('/usr/bin/pgrep -f WeChat.app/Contents/MacOS/WeChat', { encoding: 'utf8' })
      const ids = fuzzy.split(/\r?\n/).map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n) && n > 0)
      if (ids.length > 0) return Math.max(...ids)
    } catch {
      // ignore
    }

    try {
      const output = execSync('/bin/ps -A -o pid,comm,command', { encoding: 'utf8' })
      const lines = output.split(/\r?\n/).slice(1)
      const candidates: number[] = []

      for (const line of lines) {
        const match = line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/)
        if (!match) continue

        const pid = parseInt(match[1], 10)
        const comm = match[2]
        const command = match[3]
        const isMain = comm === 'WeChat' || command.includes('/Contents/MacOS/WeChat')
        const isHelper = command.includes('WeChatAppEx') || command.includes('Helper') || command.includes('crashpad_handler')
        if (isMain && !isHelper) {
          candidates.push(pid)
        }
      }

      if (candidates.length > 0) {
        return Math.max(...candidates)
      }
    } catch {
      // ignore
    }

    return null
  }

  killWeChat(): boolean {
    try {
      execSync('/usr/bin/pkill -x WeChat', { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }

  async waitForWeChatExit(maxWaitSeconds = 15): Promise<boolean> {
    for (let i = 0; i < maxWaitSeconds * 2; i++) {
      if (!this.isWeChatRunning()) {
        return true
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    return !this.isWeChatRunning()
  }

  async launchWeChat(customPath?: string): Promise<boolean> {
    try {
      if (customPath && existsSync(customPath)) {
        await execFileAsync('/usr/bin/open', [customPath])
      } else {
        await execFileAsync('/usr/bin/open', ['-a', 'WeChat'])
      }
      // Returning as soon as LaunchServices accepts the request is deliberate:
      // WeChat 4.1.x only materializes its raw database key briefly during
      // startup, so a fixed delay here makes the memory scanner miss it.
      return true
    } catch {
      return false
    }
  }

  async waitForWeChatWindow(maxWaitSeconds = 15): Promise<boolean> {
    for (let i = 0; i < maxWaitSeconds * 20; i++) {
      if (this.isWeChatRunning()) {
        return true
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return false
  }

  /** Poll for the WeChat main process PID, returning as early as possible. */
  private async waitForWeChatPid(maxWaitMs = 15_000): Promise<number | null> {
    const deadline = Date.now() + maxWaitMs
    for (;;) {
      const pid = this.getWeChatPid()
      if (pid) return pid
      if (Date.now() >= deadline) return null
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }

  private getWeChatExecutable(customPath?: string): string {
    const requested = String(customPath || '').trim()
    if (requested && existsSync(requested)) {
      if (requested.endsWith('.app')) return join(requested, 'Contents', 'MacOS', 'WeChat')
      return requested
    }
    return '/Applications/WeChat.app/Contents/MacOS/WeChat'
  }

  private async resumeWeChatAfterDebugger(): Promise<void> {
    try {
      await execFileAsync('/usr/bin/pkill', ['-CONT', '-x', 'WeChat'])
    } catch {
      // No matching process is normal when LLDB could not launch WeChat.
    }
  }

  /**
   * Capture the raw account key at the moment WeChat asks Apple's CommonCrypto
   * to derive a WCDB key, then verify it against the selected account database.
   *
   * The raw key only exists in memory during derivation (a read-only scan of an
   * already-logged-in process cannot find it), so we relaunch WeChat under our
   * control and attach LLDB with a conditional breakpoint on the exact
   * `CCKeyDerivationPBKDF` call WeChat uses for WCDB:
   *   CCKeyDerivationPBKDF(kCCPBKDF2, rawKey[32], 32, salt[16], 16,
   *                        kCCPRFHmacAlgSHA512(=5), 256000, derived, 32)
   * On ARM64 the raw key is at $x1 and the file salt at $x3. Every database of an
   * account is encrypted with the SAME raw key (only the per-file salt differs),
   * so any matching derivation yields the usable key; we verify the captured
   * bytes against the selected account database before returning.
   *
   * This is source-only and account-independent: no AIWC DLL or persisted
   * key cache is involved.
   */
  async captureDbKeyOnLaunch(
    customPath: string | undefined,
    dbRootPath: string,
    timeoutMs = 60_000,
    onStatus?: (message: string, level: number) => void
  ): Promise<DbKeyResult> {
    const validationDb = this.findPreferredDbForKeyValidation(dbRootPath)
    if (!existsSync(validationDb)) return { success: false, error: '未找到用于密钥校验的微信数据库' }
    if (!existsSync('/usr/bin/lldb')) return { success: false, error: '系统未安装 LLDB（需要 Apple Command Line Tools）' }

    const page = readFileSync(validationDb).subarray(0, DB_PAGE_SIZE)
    if (page.length !== DB_PAGE_SIZE) return { success: false, error: '微信数据库首页不完整' }

    // Match any WCDB key derivation. We intentionally do NOT pin the salt to one
    // database: WeChat opens several databases at startup in an unpredictable
    // order, and pinning the salt made the breakpoint miss the first (and often
    // only) derivation. The captured key is verified against the account
    // database afterwards, which is what actually guarantees correctness.
    const condition = ['$x2 == 32', '$x4 == 16', '$x5 == 5', '$x6 == 256000'].join(' && ')
    const finishCommands = [
      '-o', 'memory read --force --format x --size 1 --count 32 $x1',
      '-o', 'process detach',
      '-o', 'quit'
    ]
    // Attach to a *running* WeChat (started via LaunchServices) rather than
    // launching the executable directly under LLDB: the sandboxed, hardened
    // WeChat app only initializes its data container correctly when launched by
    // LaunchServices, so `target create + run` frequently fails to reach the
    // real database open.
    const runLldb = async (pid: number, timeout: number): Promise<string> => {
      const args = [
        '--no-lldbinit', '--batch',
        '-o', `process attach --pid ${pid}`,
        '-o', 'breakpoint set --name CCKeyDerivationPBKDF',
        '-o', `breakpoint modify --condition '${condition}' 1`,
        '-o', 'continue',
        ...finishCommands
      ]
      try {
        const result = await execFileAsync('/usr/bin/lldb', args, {
          encoding: 'utf8',
          timeout: Math.max(15_000, timeout),
          maxBuffer: 4 * 1024 * 1024
        })
        return result.stdout
      } catch (error: any) {
        return typeof error?.stdout === 'string' ? error.stdout : ''
      }
    }

    // Relaunch WeChat ourselves so the databases are (re)opened while the
    // debugger is armed.
    if (this.isWeChatRunning()) {
      onStatus?.('正在重启微信以捕获密钥派生...', 0)
      this.killWeChat()
      await this.waitForWeChatExit(20)
    }
    onStatus?.('正在启动微信...', 0)
    if (!(await this.launchWeChat(customPath))) return { success: false, error: '启动微信失败' }

    const startedAt = Date.now()
    let pid = await this.waitForWeChatPid(15_000)
    if (!pid) {
      await this.resumeWeChatAfterDebugger()
      return { success: false, error: '微信启动后未检测到主进程' }
    }

    onStatus?.('已挂载调试器，正在捕获密钥派生（若微信停在登录页，请扫码登录并进入任意聊天）...', 0)

    let key: Buffer | null = null
    // `continue` blocks until the breakpoint fires (or the timeout kills LLDB),
    // so this loop costs nothing while waiting. It re-attaches when WeChat
    // replaces its process or when a stray derivation fails verification.
    while (Date.now() - startedAt < timeoutMs) {
      const remaining = timeoutMs - (Date.now() - startedAt)
      const output = await runLldb(pid, remaining)
      const candidate = parseLldbKeyBytes(output)
      if (candidate && validateRawDbKey(validationDb, candidate)) {
        key = candidate
        break
      }
      await this.resumeWeChatAfterDebugger()
      const nextPid = this.getWeChatPid()
      if (!nextPid) break
      pid = nextPid
      // Guard against a fast-failing attach (e.g. transient permission error)
      // turning the retry loop into a busy spin.
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    await this.resumeWeChatAfterDebugger()
    if (!key) {
      return {
        success: false,
        error: '未捕获到与当前账号数据库匹配的密钥派生调用，请确认微信已登录该账号并进入任意聊天后重试'
      }
    }
    onStatus?.('已捕获并验证当前账号数据库密钥', 1)
    return { success: true, key: key.toString('hex') }
  }

  private findPreferredDbForKeyValidation(dbRootPath: string): string {
    const roots: string[] = []
    const pushRoot = (value?: string) => {
      if (value && existsSync(value) && !roots.includes(value)) roots.push(value)
    }
    pushRoot(this.detectCurrentAccount(dbRootPath, 60)?.dbPath)
    pushRoot(dbRootPath)

    const relativeCandidates = [
      join('db_storage', 'session', 'session.db'),
      join('db_storage', 'contact', 'contact.db'),
      join('session', 'session.db'),
      join('contact', 'contact.db'),
    ]
    for (const root of roots) {
      for (const relativePath of relativeCandidates) {
        const candidate = join(root, relativePath)
        if (existsSync(candidate)) return candidate
      }
    }
    return dbRootPath
  }

  async autoGetDbKey(
    timeoutMs = 60_000,
    onStatus?: (message: string, level: number) => void,
    dbRootPath?: string
  ): Promise<DbKeyResult> {
    try {
      const validationDb = dbRootPath ? this.findPreferredDbForKeyValidation(dbRootPath) : undefined
      const sipStatus = await this.checkSipStatus()
      onStatus?.('正在获取数据库密钥...', 0)
      const pid = this.getWeChatPid()
      if (!sipStatus.enabled && pid && dbRootPath && validationDb) {
        // The native helper starts first because the 4.1.x raw UUID key can
        // disappear in well under a second after the process becomes visible.
        onStatus?.('正在使用开源原生助手捕获启动阶段密钥...', 0)
        const nativeOpenScan = await this.getDbKeyByOpenMemoryHelper(pid, validationDb, timeoutMs)
        if (nativeOpenScan.key) {
          onStatus?.('开源原生扫描已获取候选密钥', 1)
          return { success: true, key: nativeOpenScan.key }
        }
      }

      // Dumps are a useful cache fallback, but they must never run before the
      // live scan: on a brand-new account there is no matching dump yet and the
      // delay loses WeChat's short-lived startup key window.
      if (validationDb) {
        onStatus?.('实时捕获未命中，正在检查微信本机崩溃转储...', 0)
        const dumpScan = await this.getDbKeyFromCrashDumps(validationDb, timeoutMs)
        if (dumpScan.key) {
          onStatus?.('已从微信本机转储获取并验证数据库密钥', 1)
          return { success: true, key: dumpScan.key }
        }
      }

      if (sipStatus.enabled) {
        return {
          success: false,
          error: 'SIP (系统完整性保护) 已开启，无法获取密钥。请关闭 SIP 后重试。\n\n关闭方法：\n1. Intel 芯片：重启 Mac 并按住 Command + R 进入恢复模式\n2. Apple 芯片（M 系列）：关机后长按开机（指纹）键，选择“设置（选项）”进入恢复模式\n3. 打开终端，输入: csrutil disable\n4. 重启电脑'
        }
      }

      if (pid && dbRootPath) {
        onStatus?.('正在使用开源只读内存扫描匹配数据库 salt...', 0)
        const openScan = await scanMacosMemoryForDbKey(pid, dbRootPath, (bytes) => {
          onStatus?.(`开源扫描已读取 ${Math.round(bytes / 1024 / 1024)} MB...`, 0)
        })
        if (openScan.key) {
          onStatus?.('开源内存扫描已获取候选密钥', 1)
          return { success: true, key: openScan.key }
        }
      }

      const error = '开放内存扫描未找到与数据库 salt 匹配的密钥；请在登录后尽快重试或手动填写密钥'
      onStatus?.(error, 2)
      return { success: false, error }
    } catch (e: any) {
      logMacKey('error', '[WxKeyServiceMac] 获取密钥失败:', e)
      logMacKey('error', '[WxKeyServiceMac] Stack:', e.stack)
      onStatus?.(`获取失败: ${e.message}`, 2)
      return { success: false, error: e.message }
    }
  }

  private async getDbKeyFromCrashDumps(
    dbRootPath: string,
    timeoutMs: number
  ): Promise<{ key?: string }> {
    const dumpPath = join(
      homedir(),
      'Library', 'Containers', 'com.tencent.xinWeChat', 'Data', 'Documents',
      'app_data', 'crashinfo', 'completed'
    )
    if (!existsSync(dumpPath)) return {}
    try {
      const helperPath = this.getOpenMemoryScanHelperPath()
      let stdout = ''
      try {
        const result = await execFileAsync(helperPath, ['--dump', dumpPath, dbRootPath], {
          timeout: Math.max(timeoutMs, 30_000),
          maxBuffer: 1024 * 1024
        })
        stdout = result.stdout
      } catch (error: any) {
        stdout = typeof error?.stdout === 'string' ? error.stdout : ''
      }
      const payloadLine = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1)
      if (!payloadLine) return {}
      const payload = JSON.parse(payloadLine)
      const key = typeof payload?.key === 'string' && /^[0-9a-fA-F]{64}$/.test(payload.key)
        ? payload.key.toLowerCase()
        : undefined
      return { key }
    } catch (error: any) {
      logMacKey('warn', '[WxKeyServiceMac] crash dump key scan unavailable:', error?.message || error)
      return {}
    }
  }

  private async getDbKeyByOpenMemoryHelper(
    pid: number,
    dbRootPath: string,
    timeoutMs: number
  ): Promise<{ key?: string; attached: boolean }> {
    try {
      const helperPath = this.getOpenMemoryScanHelperPath()
      let stdout = ''
      try {
        const result = await execFileAsync(helperPath, [String(pid), dbRootPath], {
          timeout: Math.max(timeoutMs, 30_000),
          maxBuffer: 1024 * 1024
        })
        stdout = result.stdout
      } catch (error: any) {
        // A completed scan with no match deliberately exits non-zero; its JSON is
        // still authoritative. Launch/timeout failures have no parseable payload.
        stdout = typeof error?.stdout === 'string' ? error.stdout : ''
      }

      const payloadLine = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1)
      if (!payloadLine) return { attached: false }
      const payload = JSON.parse(payloadLine)
      const key = typeof payload?.key === 'string' && /^[0-9a-fA-F]{64}$/.test(payload.key)
        ? payload.key.toLowerCase()
        : undefined
      return { key, attached: payload?.attached === true }
    } catch (error: any) {
      logMacKey('warn', '[WxKeyServiceMac] open native memory helper unavailable:', error?.message || error)
      return { attached: false }
    }
  }

  async autoGetImageKey(
    accountPath?: string,
    onStatus?: (message: string) => void,
    wxid?: string
  ): Promise<ImageKeyResult> {
    try {
      onStatus?.('正在从 kvcomm 缓存收集密钥码...')
      const codes = this.collectKvcommCodes(accountPath)
      if (codes.length === 0) {
        return { success: false, error: '未找到有效的 kvcomm 密钥码' }
      }

      const wxidCandidates = this.collectWxidCandidates(accountPath, wxid)
      const accountPathCandidates = this.collectAccountPathCandidates(accountPath)

      if (accountPathCandidates.length > 0) {
        onStatus?.(`正在校验候选账号（${wxidCandidates.length} 个）...`)
        for (const candidateAccountPath of accountPathCandidates) {
          if (!existsSync(candidateAccountPath)) continue
          const template = await this.findTemplateData(candidateAccountPath, 32)
          if (!template.ciphertext) continue

          const orderedWxids: string[] = []
          this.pushAccountIdCandidates(orderedWxids, basename(candidateAccountPath))
          for (const candidate of wxidCandidates) {
            this.pushAccountIdCandidates(orderedWxids, candidate)
          }

          for (const candidateWxid of orderedWxids) {
            for (const code of codes) {
              const { xorKey, aesKey } = this.deriveImageKeys(code, candidateWxid)
              if (!this.verifyDerivedAesKey(aesKey, template.ciphertext)) continue
              onStatus?.(`图片密钥获取成功 (wxid: ${candidateWxid}, code: ${code})`)
              return { success: true, xorKey, aesKey }
            }
          }
        }

        return {
          success: false,
          error: 'kvcomm 密钥码与当前账号目录未匹配，请确认账号目录后重试。'
        }
      }

      const fallbackWxid = wxidCandidates[0]
      const fallbackCode = codes[0]
      const { xorKey, aesKey } = this.deriveImageKeys(fallbackCode, fallbackWxid)
      onStatus?.(`图片密钥获取成功 (wxid: ${fallbackWxid}, code: ${fallbackCode})`)
      return { success: true, xorKey, aesKey }
    } catch (e: any) {
      return { success: false, error: `自动获取图片密钥失败: ${e.message}` }
    }
  }

  async autoGetImageKeyByMemoryScan(
    userDir: string,
    onProgress?: (message: string) => void
  ): Promise<ImageKeyResult> {
    try {
      const sipStatus = await this.checkSipStatus()
      if (sipStatus.enabled) {
        return {
          success: false,
          error: 'SIP (系统完整性保护) 已开启，内存扫描需要关闭 SIP 后重试'
        }
      }

      onProgress?.('正在查找图片模板文件...')
      let result = await this.findTemplateData(userDir, 32)
      let { ciphertext, xorKey } = result

      if (ciphertext && xorKey === null) {
        onProgress?.('模板尾部校验未命中，扩大扫描范围重试...')
        result = await this.findTemplateData(userDir, 100)
        xorKey = result.xorKey
      }

      if (!ciphertext) {
        return { success: false, error: '未找到 V2 模板文件，请先在微信中打开几张图片后重试。' }
      }
      if (xorKey === null) {
        return { success: false, error: '未能从模板文件中计算出有效 XOR 密钥。' }
      }

      onProgress?.(`XOR 密钥: 0x${xorKey.toString(16).padStart(2, '0')}，正在查找微信进程...`)

      const deadline = Date.now() + 60_000
      let scanCount = 0
      let lastPid: number | null = null

      while (Date.now() < deadline) {
        const pid = this.getWeChatPid()
        if (!pid) {
          onProgress?.('暂未检测到微信主进程，请先启动微信...')
          await new Promise(resolve => setTimeout(resolve, 2000))
          continue
        }

        if (lastPid !== pid) {
          lastPid = pid
          onProgress?.(`已找到微信进程 PID=${pid}，开始扫描内存...`)
        }

        scanCount += 1
        onProgress?.(`第 ${scanCount} 次扫描内存，请保持图片已在微信中打开...`)
        const aesKey = await this.scanMemoryForAesKey(pid, ciphertext, onProgress)
        if (aesKey) {
          onProgress?.('图片密钥获取成功')
          return { success: true, xorKey, aesKey }
        }

        await new Promise(resolve => setTimeout(resolve, 5000))
      }

      return { success: false, error: '60 秒内未找到 AES 密钥。' }
    } catch (e: any) {
      return { success: false, error: `内存扫描失败: ${e.message}` }
    }
  }

  detectCurrentAccount(dbPath?: string, maxTimeDiffMinutes: number = 5): { wxid: string; dbPath: string } | null {
    if (!dbPath || !existsSync(dbPath)) {
      return null
    }

    const accountDirs = this.findAccountDirectories(dbPath)
    if (accountDirs.length === 0) {
      return null
    }

    const now = Date.now()
    const maxDiffMs = maxTimeDiffMinutes * 60 * 1000
    let bestMatch: { wxid: string; dbPath: string; diff: number } | null = null
    let fallback: { wxid: string; dbPath: string; diff: number } | null = null

    for (const accountDir of accountDirs) {
      const modifiedTime = this.getAccountModifiedTime(accountDir)
      const diff = Math.abs(now - modifiedTime)
      const wxid = basename(accountDir)

      if (diff <= maxDiffMs && (!bestMatch || diff < bestMatch.diff)) {
        bestMatch = { wxid, dbPath: accountDir, diff }
      }
      if (!fallback || diff < fallback.diff) {
        fallback = { wxid, dbPath: accountDir, diff }
      }
    }

    if (bestMatch) {
      return { wxid: bestMatch.wxid, dbPath: bestMatch.dbPath }
    }

    if (fallback && (accountDirs.length === 1 || fallback.diff <= 24 * 60 * 60 * 1000)) {
      return { wxid: fallback.wxid, dbPath: fallback.dbPath }
    }

    return null
  }

  private findAccountDirectories(rootOrAccountPath: string): string[] {
    if (!existsSync(rootOrAccountPath)) return []
    if (this.isAccountDirPath(rootOrAccountPath)) return [rootOrAccountPath]

    const result: string[] = []
    try {
      for (const entry of readdirSync(rootOrAccountPath, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const entryPath = join(rootOrAccountPath, entry.name)
        if (!this.isReasonableAccountId(entry.name)) continue
        if (this.isAccountDirPath(entryPath)) {
          result.push(entryPath)
        }
      }
    } catch {
      // ignore
    }
    return result
  }

  private getAccountModifiedTime(accountDir: string): number {
    try {
      const accountStat = statSync(accountDir)
      let latest = accountStat.mtimeMs
      const candidates = [
        join(accountDir, 'db_storage'),
        join(accountDir, 'FileStorage', 'Image'),
        join(accountDir, 'FileStorage', 'Image2'),
        join(accountDir, 'msg', 'attach')
      ]
      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          latest = Math.max(latest, statSync(candidate).mtimeMs)
        }
      }
      return latest
    } catch {
      return 0
    }
  }

  private normalizeAccountId(value: string): string {
    const trimmed = String(value || '').trim()
    if (!trimmed) return ''

    if (trimmed.toLowerCase().startsWith('wxid_')) {
      const match = trimmed.match(/^(wxid_[^_]+)/i)
      return match?.[1] || trimmed
    }

    const suffixMatch = trimmed.match(/^(.+)_([a-zA-Z0-9]{4})$/)
    return suffixMatch ? suffixMatch[1] : trimmed
  }

  private isIgnoredAccountName(value: string): boolean {
    const lowered = String(value || '').trim().toLowerCase()
    if (!lowered) return true
    return lowered === 'xwechat_files' ||
      lowered === 'all_users' ||
      lowered === 'backup' ||
      lowered === 'wmpf' ||
      lowered === 'app_data'
  }

  private isReasonableAccountId(value: string): boolean {
    const trimmed = String(value || '').trim()
    if (!trimmed) return false
    if (trimmed.includes('/') || trimmed.includes('\\')) return false
    return !this.isIgnoredAccountName(trimmed)
  }

  private isAccountDirPath(entryPath: string): boolean {
    return existsSync(join(entryPath, 'db_storage')) ||
      existsSync(join(entryPath, 'msg')) ||
      existsSync(join(entryPath, 'FileStorage', 'Image')) ||
      existsSync(join(entryPath, 'FileStorage', 'Image2'))
  }

  private resolveXwechatRootFromPath(accountPath?: string): string | null {
    const normalized = String(accountPath || '').replace(/\\/g, '/').replace(/\/+$/, '')
    if (!normalized) return null

    const oldMarker = '/xwechat_files'
    const oldIndex = normalized.indexOf(oldMarker)
    if (oldIndex >= 0) {
      return normalized.slice(0, oldIndex + oldMarker.length)
    }

    const newMarkerMatch = normalized.match(/^(.*\/com\.tencent\.xinWeChat\/(?:\d+\.\d+b\d+\.\d+|\d+\.\d+\.\d+))(\/|$)/)
    if (newMarkerMatch) {
      return newMarkerMatch[1]
    }

    return null
  }

  private pushAccountIdCandidates(candidates: string[], value?: string): void {
    const raw = String(value || '').trim()
    if (!this.isReasonableAccountId(raw)) return

    const pushUnique = (item: string) => {
      const trimmed = String(item || '').trim()
      if (!trimmed || candidates.includes(trimmed)) return
      candidates.push(trimmed)
    }

    pushUnique(raw)
    const normalized = this.normalizeAccountId(raw)
    if (normalized && normalized !== raw && this.isReasonableAccountId(normalized)) {
      pushUnique(normalized)
    }
  }

  private cleanWxid(wxid: string): string {
    return this.normalizeAccountId(wxid)
  }

  private deriveImageKeys(code: number, wxid: string): { xorKey: number; aesKey: string } {
    const cleanedWxid = this.cleanWxid(wxid)
    const xorKey = code & 0xFF
    const dataToHash = code.toString() + cleanedWxid
    const aesKey = crypto.createHash('md5').update(dataToHash).digest('hex').substring(0, 16)
    return { xorKey, aesKey }
  }

  private collectWxidCandidates(accountPath?: string, wxidParam?: string): string[] {
    const candidates: string[] = []
    this.pushAccountIdCandidates(candidates, wxidParam)

    if (accountPath) {
      const normalized = accountPath.replace(/\\/g, '/').replace(/\/+$/, '')
      this.pushAccountIdCandidates(candidates, basename(normalized))

      const root = this.resolveXwechatRootFromPath(accountPath)
      if (root && existsSync(root)) {
        try {
          for (const entry of readdirSync(root, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue
            const entryPath = join(root, entry.name)
            if (this.isAccountDirPath(entryPath)) {
              this.pushAccountIdCandidates(candidates, entry.name)
            }
          }
        } catch {
          // ignore
        }
      }
    }

    return candidates.length > 0 ? candidates : ['unknown']
  }

  private collectAccountPathCandidates(accountPath?: string): string[] {
    const candidates: string[] = []
    const pushUnique = (value?: string) => {
      const item = String(value || '').trim()
      if (!item || candidates.includes(item)) return
      candidates.push(item)
    }

    if (accountPath) pushUnique(accountPath)

    if (accountPath) {
      const root = this.resolveXwechatRootFromPath(accountPath)
      if (root && existsSync(root)) {
        try {
          for (const entry of readdirSync(root, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue
            const entryPath = join(root, entry.name)
            if (!this.isReasonableAccountId(entry.name)) continue
            if (this.isAccountDirPath(entryPath)) {
              pushUnique(entryPath)
            }
          }
        } catch {
          // ignore
        }
      }
    }

    return candidates
  }

  private verifyDerivedAesKey(aesKey: string, ciphertext: Buffer): boolean {
    try {
      const keyBytes = Buffer.from(aesKey, 'ascii').subarray(0, 16)
      const decipher = crypto.createDecipheriv('aes-128-ecb', keyBytes, null)
      decipher.setAutoPadding(false)
      const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      return (
        (dec[0] === 0xFF && dec[1] === 0xD8 && dec[2] === 0xFF) ||
        (dec[0] === 0x89 && dec[1] === 0x50 && dec[2] === 0x4E && dec[3] === 0x47) ||
        (dec[0] === 0x52 && dec[1] === 0x49 && dec[2] === 0x46 && dec[3] === 0x46) ||
        (dec[0] === 0x77 && dec[1] === 0x78 && dec[2] === 0x67 && dec[3] === 0x66) ||
        (dec[0] === 0x47 && dec[1] === 0x49 && dec[2] === 0x46)
      )
    } catch {
      return false
    }
  }

  private collectKvcommCodes(accountPath?: string): number[] {
    const codeSet = new Set<number>()
    const pattern = /^key_(\d+)_.+\.statistic$/i

    for (const kvcommDir of this.getKvcommCandidates(accountPath)) {
      if (!existsSync(kvcommDir)) continue
      try {
        for (const file of readdirSync(kvcommDir)) {
          const match = file.match(pattern)
          if (!match) continue
          const code = Number(match[1])
          if (Number.isFinite(code) && code > 0 && code <= 0xFFFFFFFF) {
            codeSet.add(code)
          }
        }
      } catch {
        // ignore
      }
    }

    return Array.from(codeSet)
  }

  private getKvcommCandidates(accountPath?: string): string[] {
    const home = homedir()
    const candidates = new Set<string>([
      join(home, 'Library', 'Containers', 'com.tencent.xinWeChat', 'Data', 'Documents', 'app_data', 'net', 'kvcomm'),
      join(home, 'Library', 'Containers', 'com.tencent.xinWeChat', 'Data', 'Library', 'Application Support', 'com.tencent.xinWeChat', 'xwechat', 'net', 'kvcomm'),
      join(home, 'Library', 'Containers', 'com.tencent.xinWeChat', 'Data', 'Library', 'Application Support', 'com.tencent.xinWeChat', 'net', 'kvcomm'),
      join(home, 'Library', 'Containers', 'com.tencent.xinWeChat', 'Data', 'Documents', 'xwechat', 'net', 'kvcomm')
    ])

    if (accountPath) {
      const normalized = accountPath.replace(/\\/g, '/').replace(/\/+$/, '')
      const oldMarker = '/xwechat_files'
      const oldIndex = normalized.indexOf(oldMarker)
      if (oldIndex >= 0) {
        candidates.add(`${normalized.slice(0, oldIndex)}/app_data/net/kvcomm`)
      }

      const newMarkerMatch = normalized.match(/^(.*\/com\.tencent\.xinWeChat\/(?:\d+\.\d+b\d+\.\d+|\d+\.\d+\.\d+))/)
      if (newMarkerMatch) {
        const versionBase = newMarkerMatch[1]
        candidates.add(`${versionBase}/net/kvcomm`)
        candidates.add(`${versionBase.replace(/\/[^\/]+$/, '')}/net/kvcomm`)
      }

      let cursor = accountPath
      for (let i = 0; i < 6; i++) {
        candidates.add(join(cursor, 'net', 'kvcomm'))
        const next = dirname(cursor)
        if (next === cursor) break
        cursor = next
      }
    }

    return Array.from(candidates)
  }

  private async findTemplateData(userDir: string, limit = 32): Promise<{ ciphertext: Buffer | null; xorKey: number | null }> {
    const magic = Buffer.from([0x07, 0x08, 0x56, 0x32, 0x08, 0x07])
    const files: string[] = []

    const collect = (dir: string) => {
      if (files.length >= limit) return
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (files.length >= limit) break
          const fullPath = join(dir, entry.name)
          if (entry.isDirectory()) {
            collect(fullPath)
          } else if (entry.isFile() && entry.name.endsWith('_t.dat')) {
            files.push(fullPath)
          }
        }
      } catch {
        // ignore
      }
    }

    collect(userDir)
    files.sort((a, b) => {
      try {
        return statSync(b).mtimeMs - statSync(a).mtimeMs
      } catch {
        return 0
      }
    })

    let ciphertext: Buffer | null = null
    const tailCounts = new Map<string, number>()

    for (const file of files.slice(0, 32)) {
      try {
        const data = readFileSync(file)
        if (data.length < 8 || !data.subarray(0, 6).equals(magic)) continue

        if (data.length >= 0x1F && !ciphertext) {
          ciphertext = data.subarray(0x0F, 0x1F)
        }

        const key = `${data[data.length - 2]}_${data[data.length - 1]}`
        tailCounts.set(key, (tailCounts.get(key) || 0) + 1)
      } catch {
        // ignore
      }
    }

    let xorKey: number | null = null
    let maxCount = 0

    for (const [key, count] of tailCounts.entries()) {
      if (count <= maxCount) continue
      const [x, y] = key.split('_').map(Number)
      const candidate = x ^ 0xFF
      if (candidate === (y ^ 0xD9)) {
        maxCount = count
        xorKey = candidate
      }
    }

    return { ciphertext, xorKey }
  }

  private ensureMachApis(): boolean {
    if (this.machTaskSelf && this.taskForPid && this.machVmRegion && this.machVmReadOverwrite) {
      return true
    }

    try {
      if (!this.koffi) {
        this.koffi = require('koffi')
      }

      logMacKey('log', '[WxKeyServiceMac] 加载 Mach API: /usr/lib/libSystem.B.dylib')
      this.libSystem = this.koffi.load('/usr/lib/libSystem.B.dylib')
      this.machTaskSelf = this.libSystem.func('mach_task_self', 'uint32', [])
      this.taskForPid = this.libSystem.func('task_for_pid', 'int', ['uint32', 'int', this.koffi.out('uint32*')])
      this.machVmRegion = this.libSystem.func('mach_vm_region', 'int', [
        'uint32',
        this.koffi.out('uint64*'),
        this.koffi.out('uint64*'),
        'int',
        'void*',
        this.koffi.out('uint32*'),
        this.koffi.out('uint32*')
      ])
      this.machVmReadOverwrite = this.libSystem.func('mach_vm_read_overwrite', 'int', [
        'uint32',
        'uint64',
        'uint64',
        'void*',
        this.koffi.out('uint64*')
      ])
      this.machPortDeallocate = this.libSystem.func('mach_port_deallocate', 'int', ['uint32', 'uint32'])
      return true
    } catch (e: any) {
      logMacKey('error', '[WxKeyServiceMac] 初始化 Mach API 失败:', e?.message || e)
      return false
    }
  }

  private async scanMemoryForAesKey(
    pid: number,
    ciphertext: Buffer,
    onProgress?: (message: string) => void
  ): Promise<string | null> {
    const ciphertextHex = ciphertext.toString('hex')
    try {
      const openHelper = this.getOpenMemoryScanHelperPath()
      const openResult = await this.spawnOpenImageScanHelper(openHelper, pid, ciphertextHex)
      if (openResult) return openResult
    } catch (e: any) {
      logMacKey('warn', '[WxKeyServiceMac] open image memory helper unavailable:', e?.message || e)
    }

    if (!this.ensureMachApis()) {
      return null
    }

    const VM_PROT_READ = 0x1
    const VM_PROT_WRITE = 0x2
    const VM_REGION_BASIC_INFO_64 = 9
    const VM_REGION_BASIC_INFO_COUNT_64 = 9
    const KERN_SUCCESS = 0
    const MAX_REGION_SIZE = 50 * 1024 * 1024
    const CHUNK = 4 * 1024 * 1024
    const OVERLAP = 65

    const selfTask = this.machTaskSelf()
    const taskBuf = Buffer.alloc(4)
    const attachKr = this.taskForPid(selfTask, pid, taskBuf)
    const task = taskBuf.readUInt32LE(0)
    if (attachKr !== KERN_SUCCESS || !task) {
      logMacKey('error', `[WxKeyServiceMac] task_for_pid 失败: kr=${attachKr}, task=${task}, pid=${pid}（可能需要关闭 SIP 或授予调试权限）`)
      return null
    }

    try {
      const regions: Array<[number, number]> = []
      let address = 0

      while (address < 0x7FFFFFFFFFFF) {
        const addrBuf = Buffer.alloc(8)
        addrBuf.writeBigUInt64LE(BigInt(address), 0)
        const sizeBuf = Buffer.alloc(8)
        const infoBuf = Buffer.alloc(64)
        const countBuf = Buffer.alloc(4)
        countBuf.writeUInt32LE(VM_REGION_BASIC_INFO_COUNT_64, 0)
        const objectBuf = Buffer.alloc(4)

        const kr = this.machVmRegion(task, addrBuf, sizeBuf, VM_REGION_BASIC_INFO_64, infoBuf, countBuf, objectBuf)
        if (kr !== KERN_SUCCESS) break

        const base = Number(addrBuf.readBigUInt64LE(0))
        const size = Number(sizeBuf.readBigUInt64LE(0))
        const protection = infoBuf.readInt32LE(0)
        const objectName = objectBuf.readUInt32LE(0)
        if (objectName) {
          try { this.machPortDeallocate(selfTask, objectName) } catch { }
        }

        if ((protection & VM_PROT_READ) !== 0 && (protection & VM_PROT_WRITE) !== 0 && size > 0 && size <= MAX_REGION_SIZE) {
          regions.push([base, size])
        }

        const next = base + size
        if (next <= address) break
        address = next
      }

      const totalMB = regions.reduce((sum, [, size]) => sum + size, 0) / 1024 / 1024
      onProgress?.(`扫描 ${regions.length} 个内存区域 (${totalMB.toFixed(0)} MB)...`)

      for (let regionIndex = 0; regionIndex < regions.length; regionIndex++) {
        const [base, size] = regions[regionIndex]
        if (regionIndex % 20 === 0) {
          onProgress?.(`扫描进度 ${regionIndex}/${regions.length}...`)
          await new Promise(resolve => setTimeout(resolve, 1))
        }

        let offset = 0
        let trailing: Buffer | null = null

        while (offset < size) {
          const chunkSize = Math.min(CHUNK, size - offset)
          const chunk = Buffer.alloc(chunkSize)
          const outSizeBuf = Buffer.alloc(8)
          const kr = this.machVmReadOverwrite(task, base + offset, chunkSize, chunk, outSizeBuf)
          const bytesRead = Number(outSizeBuf.readBigUInt64LE(0))
          offset += chunkSize

          if (kr !== KERN_SUCCESS || bytesRead <= 0) {
            trailing = null
            continue
          }

          const current = chunk.subarray(0, bytesRead)
          const data: Buffer = trailing ? Buffer.concat([trailing, current]) : current
          const key = this.searchAsciiKey(data, ciphertext) || this.searchUtf16Key(data, ciphertext) || this.searchAny16Key(data, ciphertext)
          if (key) return key
          trailing = data.subarray(Math.max(0, data.length - OVERLAP))
        }
      }
    } finally {
      try { this.machPortDeallocate(selfTask, task) } catch { }
    }

    return null
  }

  private spawnOpenImageScanHelper(
    helperPath: string,
    pid: number,
    ciphertextHex: string
  ): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const child = spawn(helperPath, ['--image', String(pid), ciphertextHex], {
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let stdout = ''
      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      child.on('error', reject)
      child.on('close', () => {
        try {
          const last = stdout.split(/\r?\n/).map(x => x.trim()).filter(Boolean).at(-1)
          const payload = last ? JSON.parse(last) : null
          const keyHex = typeof payload?.aesKeyHex === 'string' ? payload.aesKeyHex : ''
          resolve(payload?.success && /^[0-9a-fA-F]{32}$/.test(keyHex)
            ? Buffer.from(keyHex, 'hex').toString('ascii')
            : null)
        } catch {
          resolve(null)
        }
      })
      setTimeout(() => {
        try { child.kill('SIGTERM') } catch { }
      }, 30_000)
    })
  }

  private searchAsciiKey(data: Buffer, ciphertext: Buffer): string | null {
    for (let i = 0; i < data.length - 34; i++) {
      if (this.isAlphaNum(data[i])) continue
      let valid = true
      for (let j = 1; j <= 32; j++) {
        if (!this.isAlphaNum(data[i + j])) {
          valid = false
          break
        }
      }
      if (!valid) continue
      if (i + 33 < data.length && this.isAlphaNum(data[i + 33])) continue
      const keyBytes = data.subarray(i + 1, i + 33)
      if (this.verifyAesKey(keyBytes, ciphertext)) {
        return keyBytes.toString('ascii').substring(0, 16)
      }
    }
    return null
  }

  private searchUtf16Key(data: Buffer, ciphertext: Buffer): string | null {
    for (let i = 0; i < data.length - 65; i++) {
      let valid = true
      for (let j = 0; j < 32; j++) {
        if (data[i + j * 2 + 1] !== 0x00 || !this.isAlphaNum(data[i + j * 2])) {
          valid = false
          break
        }
      }
      if (!valid) continue

      const keyBytes = Buffer.alloc(32)
      for (let j = 0; j < 32; j++) {
        keyBytes[j] = data[i + j * 2]
      }
      if (this.verifyAesKey(keyBytes, ciphertext)) {
        return keyBytes.toString('ascii').substring(0, 16)
      }
    }
    return null
  }

  private searchAny16Key(data: Buffer, ciphertext: Buffer): string | null {
    for (let i = 0; i + 16 <= data.length; i++) {
      const keyBytes = data.subarray(i, i + 16)
      if (!this.verifyAesKey16Raw(keyBytes, ciphertext)) continue
      if (!this.isMostlyPrintableAscii(keyBytes)) continue
      return keyBytes.toString('ascii')
    }
    return null
  }

  private isAlphaNum(byte: number): boolean {
    return (byte >= 0x61 && byte <= 0x7A) || (byte >= 0x41 && byte <= 0x5A) || (byte >= 0x30 && byte <= 0x39)
  }

  private verifyAesKey(keyBytes: Buffer, ciphertext: Buffer): boolean {
    try {
      const decipher = crypto.createDecipheriv('aes-128-ecb', keyBytes.subarray(0, 16), null)
      decipher.setAutoPadding(false)
      const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      return (
        (dec[0] === 0xFF && dec[1] === 0xD8 && dec[2] === 0xFF) ||
        (dec[0] === 0x89 && dec[1] === 0x50 && dec[2] === 0x4E && dec[3] === 0x47) ||
        (dec[0] === 0x52 && dec[1] === 0x49 && dec[2] === 0x46 && dec[3] === 0x46) ||
        (dec[0] === 0x77 && dec[1] === 0x78 && dec[2] === 0x67 && dec[3] === 0x66) ||
        (dec[0] === 0x47 && dec[1] === 0x49 && dec[2] === 0x46)
      )
    } catch {
      return false
    }
  }

  private verifyAesKey16Raw(keyBytes: Buffer, ciphertext: Buffer): boolean {
    try {
      const decipher = crypto.createDecipheriv('aes-128-ecb', keyBytes, null)
      decipher.setAutoPadding(false)
      const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      return (
        (dec[0] === 0xFF && dec[1] === 0xD8 && dec[2] === 0xFF) ||
        (dec[0] === 0x89 && dec[1] === 0x50 && dec[2] === 0x4E && dec[3] === 0x47) ||
        (dec[0] === 0x52 && dec[1] === 0x49 && dec[2] === 0x46 && dec[3] === 0x46) ||
        (dec[0] === 0x77 && dec[1] === 0x78 && dec[2] === 0x67 && dec[3] === 0x66) ||
        (dec[0] === 0x47 && dec[1] === 0x49 && dec[2] === 0x46)
      )
    } catch {
      return false
    }
  }

  private isMostlyPrintableAscii(keyBytes: Buffer): boolean {
    let printable = 0
    for (const byte of keyBytes) {
      if (byte >= 0x20 && byte <= 0x7E) {
        printable += 1
      }
    }
    return printable >= 14
  }

  dispose(): void {
    this.lib = null
    this.initialized = false
    this.GetDbKey = null
    this.ListWeChatProcesses = null
    this.libSystem = null
    this.machTaskSelf = null
    this.taskForPid = null
    this.machVmRegion = null
    this.machVmReadOverwrite = null
    this.machPortDeallocate = null
  }
}

export const wxKeyServiceMac = new WxKeyServiceMac()
