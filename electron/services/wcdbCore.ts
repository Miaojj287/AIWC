import { basename, join } from 'path'
import { existsSync, readdirSync, statSync } from 'fs'
import { decodeMessageContent, getRowField, coerceRowNumber } from './chat/rowDecoders'
import { formatWcdbOpenFailure } from './wcdbOpenFailure'
import { OpenWcdbBridge } from './openWcdbBridge'
import { SourceWcdbBridge } from './sourceWcdbBridge'

// 消息表 local_type 列在不同微信版本下的可能列名
const MSG_TYPE_COLUMNS = [
  'local_type', 'localType', 'type', 'Type',
  'msg_type', 'msgType', 'MsgType',
  'message_type', 'messageType', 'WCDB_CT_local_type'
]

/**
 * WcdbCore —— 直连微信加密数据库的底层封装。
 * - 不依赖 Electron `app`，可在 utilityProcess 中实例化
 * - 所有资源路径通过 setPaths() 注入
 * - 优先加载源码构建的 WCDB Bridge；缺失时使用仓库内的 TypeScript 解密后端
 */
export class WcdbCore {
  private initialized = false
  private handle: number | null = null
  private currentPath: string | null = null
  private currentKey: string | null = null
  private currentWxid: string | null = null
  private currentDbStoragePath: string | null = null
  private resourcesPath: string | null = null
  private userDataPath: string | null = null
  private openBridge: OpenWcdbBridge | SourceWcdbBridge | null = null
  private openDefaultDbPath: string | null = null

  setPaths(resourcesPath: string, userDataPath: string, appVersion = ''): void {
    this.resourcesPath = resourcesPath
    this.userDataPath = userDataPath
    void appVersion
  }

  getUserDataPath(): string | null { return this.userDataPath }

  private getOpenLibraryPath(): string {
    const override = String(process.env.CT_OPEN_WCDB_LIBRARY || '').trim()
    if (override) return override
    const baseDir = this.resourcesPath || join(process.cwd(), 'resources')
    if (process.platform === 'darwin') return join(baseDir, 'macos', 'libWCDBOpen.dylib')
    return join(baseDir, 'wcdb_open.dll')
  }

  async initialize(): Promise<{ success: boolean; error?: string }> {
    if (this.initialized) return { success: true }

    try {
      const openLibraryPath = this.getOpenLibraryPath()
      const bridge = existsSync(openLibraryPath)
        ? new OpenWcdbBridge()
        : new SourceWcdbBridge()
      const result = bridge instanceof OpenWcdbBridge
        ? bridge.initialize(openLibraryPath)
        : bridge.initialize(this.userDataPath || '')
      if (!result.success) return result
      this.openBridge = bridge
      this.initialized = true
      return { success: true }
    } catch (e: any) {
      return { success: false, error: `WCDB 初始化异常: ${e.message || String(e)}` }
    }
  }

  // ============== 路径解析 ==============
  private findSessionDbs(dir: string, depth = 0, results: string[] = []): string[] {
    if (depth > 5) return results
    try {
      const entries = readdirSync(dir)
      for (const entry of entries) {
        if (entry.toLowerCase() === 'session.db') {
          const fullPath = join(dir, entry)
          if (statSync(fullPath).isFile() && !results.includes(fullPath)) {
            results.push(fullPath)
          }
        }
      }
      for (const entry of entries) {
        const fullPath = join(dir, entry)
        try {
          if (statSync(fullPath).isDirectory()) {
            this.findSessionDbs(fullPath, depth + 1, results)
          }
        } catch {
          // ignore
        }
      }
    } catch (e) {
      console.error('查找 session.db 失败:', e)
    }
    return results
  }

  private findNamedDbs(dir: string, dbName: string, depth = 0, results: string[] = []): string[] {
    if (depth > 5) return results
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name)
        if (entry.isFile() && entry.name.toLowerCase() === dbName.toLowerCase()) results.push(fullPath)
        if (entry.isDirectory()) this.findNamedDbs(fullPath, dbName, depth + 1, results)
      }
    } catch { /* ignore inaccessible paths */ }
    return results
  }

  private resolveOpenDbPath(kind: string, explicitPath: string): string {
    if (explicitPath) return explicitPath
    const normalizedKind = String(kind || 'session').trim().toLowerCase()
    if (normalizedKind === 'session' || !this.currentDbStoragePath) return this.openDefaultDbPath || ''
    const dbName = normalizedKind.endsWith('.db') ? normalizedKind : `${normalizedKind}.db`
    const candidates = this.findNamedDbs(this.currentDbStoragePath, dbName)
    candidates.sort((a, b) => {
      const marker = `/${normalizedKind}/`
      const aScore = a.replace(/\\/g, '/').toLowerCase().includes(marker) ? 1 : 0
      const bScore = b.replace(/\\/g, '/').toLowerCase().includes(marker) ? 1 : 0
      return bScore - aScore || a.localeCompare(b)
    })
    return candidates[0] || ''
  }

  private scoreSessionDbPath(filePath: string): number {
    const normalized = filePath.replace(/\\/g, '/').toLowerCase()
    let score = 0
    if (normalized.endsWith('/session/session.db')) score += 40
    if (normalized.includes('/db_storage/session/')) score += 20
    if (normalized.includes('/db_storage/')) score += 10
    return score
  }

  private getCandidateSessionDbs(dbStoragePath: string): string[] {
    return this.findSessionDbs(dbStoragePath)
      .sort((a, b) => this.scoreSessionDbPath(b) - this.scoreSessionDbPath(a) || a.localeCompare(b))
  }

  private resolveDbStoragePath(dbPath: string, wxid: string): string | null {
    if (!dbPath) return null
    const normalizedDbPath = dbPath.replace(/[\\/]+$/, '')
    if (basename(normalizedDbPath).toLowerCase() === 'db_storage' && existsSync(normalizedDbPath)) return normalizedDbPath
    const direct = join(normalizedDbPath, 'db_storage')
    if (existsSync(direct)) return direct
    if (wxid) {
      const viaWxid = join(normalizedDbPath, wxid, 'db_storage')
      if (existsSync(viaWxid)) return viaWxid
      try {
        const lowerWxid = wxid.toLowerCase()
        for (const entry of readdirSync(normalizedDbPath)) {
          const entryPath = join(normalizedDbPath, entry)
          try { if (!statSync(entryPath).isDirectory()) continue } catch { continue }
          const lowerEntry = entry.toLowerCase()
          if (lowerEntry !== lowerWxid && !lowerEntry.startsWith(`${lowerWxid}_`)) continue
          const candidate = join(entryPath, 'db_storage')
          if (existsSync(candidate)) return candidate
        }
      } catch { /* ignore */ }
    }
    return null
  }

  private tryOpenWithCandidates(sessionDbPaths: string[], hexKey: string): { success: boolean; handle?: number; matchedPath?: string; errors: string[] } {
    const errors: string[] = []
    if (!this.openBridge) return { success: false, errors: ['数据库后端尚未初始化'] }
    for (const sessionDbPath of sessionDbPaths) {
      if (this.openBridge.canOpen(sessionDbPath, hexKey)) {
        return { success: true, handle: 1, matchedPath: sessionDbPath, errors }
      }
      errors.push(`${sessionDbPath} => 数据库后端拒绝密钥或数据库`)
    }
    return { success: false, errors }
  }

  // ============== 连接生命周期 ==============
  async open(dbPath: string, hexKey: string, wxid: string): Promise<boolean> {
    try {
      if (
        this.handle !== null &&
        this.currentPath === dbPath &&
        this.currentKey === hexKey &&
        this.currentWxid === wxid
      ) {
        return true
      }

      const initRes = await this.initialize()
      if (!initRes.success) return false

      if (this.handle !== null) {
        this.close()
        const reinitRes = await this.initialize()
        if (!reinitRes.success) return false
      }

      const dbStoragePath = this.resolveDbStoragePath(dbPath, wxid)
      if (!dbStoragePath) {
        console.error('数据库目录不存在:', dbPath)
        return false
      }

      const sessionDbPaths = this.getCandidateSessionDbs(dbStoragePath)
      if (sessionDbPaths.length === 0) {
        console.error('未找到 session.db 文件:', dbStoragePath)
        return false
      }

      const openResult = this.tryOpenWithCandidates(sessionDbPaths, hexKey)
      if (!openResult.success || !openResult.handle) {
        await this.printLogs()
        return false
      }

      const handle = openResult.handle
      if (handle <= 0) return false

      this.handle = handle
      this.currentPath = dbPath
      this.currentKey = hexKey
      this.currentWxid = wxid
      this.currentDbStoragePath = dbStoragePath
      this.openDefaultDbPath = openResult.matchedPath || null
      this.initialized = true

      return true
    } catch (e) {
      console.error('打开数据库异常:', e)
      return false
    }
  }

  close(): void {
    this.openBridge?.dispose()
    this.openBridge = null
    this.openDefaultDbPath = null
    this.handle = null
    this.initialized = false
    this.currentPath = null
    this.currentKey = null
    this.currentWxid = null
    this.currentDbStoragePath = null
  }

  shutdown(): void { this.close() }

  isConnected(): boolean { return this.initialized && this.handle !== null }

  async testConnection(dbPath: string, hexKey: string, wxid: string): Promise<{ success: boolean; error?: string; sessionCount?: number }> {
    try {
      if (this.handle !== null && this.currentPath === dbPath && this.currentKey === hexKey && this.currentWxid === wxid) {
        return { success: true, sessionCount: 0 }
      }

      const initRes = await this.initialize()
      if (!initRes.success) return { success: false, error: initRes.error || 'WCDB 初始化失败' }

      const dbStoragePath = this.resolveDbStoragePath(dbPath, wxid)
      if (!dbStoragePath) return { success: false, error: `未找到账号目录或 db_storage: ${dbPath}` }

      const sessionDbPaths = this.getCandidateSessionDbs(dbStoragePath)
      if (sessionDbPaths.length === 0) return { success: false, error: `未找到 session.db 文件: ${dbStoragePath}` }

      const openResult = this.tryOpenWithCandidates(sessionDbPaths, hexKey)
      if (!openResult.success) {
        return {
          success: false,
          error: formatWcdbOpenFailure('', openResult.errors),
        }
      }
      return { success: true, sessionCount: 0 }
    } catch (e) {
      console.error('测试连接异常:', e)
      return { success: false, error: String(e) }
    }
  }

  // ============== 查询接口 ==============
  async execQuery(kind: string, path: string, sql: string): Promise<{ success: boolean; rows?: any[]; error?: string }> {
    if (!this.initialized || this.handle === null) {
      return { success: false, error: 'WCDB 未初始化' }
    }
    try {
      if (!this.openBridge) return { success: false, error: '数据库后端尚未初始化' }
      const dbPath = this.resolveOpenDbPath(kind, path)
      if (!dbPath) return { success: false, error: `数据库后端缺少 ${kind || '默认'} 数据库路径` }
      return this.openBridge.execQuery(dbPath, sql, this.currentKey || undefined)
    } catch (e: any) {
      return { success: false, error: e.message || String(e) }
    }
  }

  /**
   * 参数化查询。
   * 参数数组需序列化为 `[{type:'string'|'int'|'double'|'bytes'|'null', value:any}]`。
   * 数据库后端直接绑定参数。
   */
  async execQueryWithParams(kind: string, path: string, sql: string, params?: any[]): Promise<{ success: boolean; rows?: any[]; error?: string }> {
    if (!this.initialized || this.handle === null) {
      return { success: false, error: 'WCDB 未初始化' }
    }
    if (!this.openBridge) return { success: false, error: '数据库后端尚未初始化' }
    const dbPath = this.resolveOpenDbPath(kind, path)
    if (!dbPath) return { success: false, error: `数据库后端缺少 ${kind || '默认'} 数据库路径` }
    const values = (params || []).map((value: any) => {
      const descriptor = this.inferParamDescriptor(value)
      if (descriptor.type === 'null') return null
      if (descriptor.type === 'bytes') return Buffer.from(String(descriptor.value || ''), 'base64')
      if (descriptor.type === 'int') {
        const raw = descriptor.value
        if (typeof raw === 'string' && /^-?\d+$/.test(raw)) return BigInt(raw)
        return Number(raw)
      }
      if (descriptor.type === 'double') return Number(descriptor.value)
      return String(descriptor.value ?? '')
    })
    return this.openBridge.execQueryWithParams(dbPath, sql, values, this.currentKey || undefined)
  }

  private inferParamDescriptor(value: any): { type: string; value: any } {
    if (value === null || value === undefined) {
      return { type: 'null', value: null }
    }
    if (typeof value === 'object' && value && typeof (value as any).type === 'string' && 'value' in value) {
      return value as { type: string; value: any }
    }
    if (typeof value === 'number') {
      return Number.isInteger(value) ? { type: 'int', value } : { type: 'double', value }
    }
    if (typeof value === 'bigint') {
      return { type: 'int', value: value.toString() }
    }
    if (typeof value === 'boolean') {
      return { type: 'int', value: value ? 1 : 0 }
    }
    if (Buffer.isBuffer(value)) {
      return { type: 'bytes', value: value.toString('base64') }
    }
    if (value instanceof Uint8Array) {
      return { type: 'bytes', value: Buffer.from(value).toString('base64') }
    }
    return { type: 'string', value: String(value) }
  }

  /**
   * 导出专用批量读取：keyset 分批查询、列裁剪、时间下推与内容解码全部在本进程内完成，
   * 每次调用最多返回 maxRows 条紧凑行（content/localType 已解码），
   * 避免把 SELECT m.* 的原始大对象（含 hex/base64 blob）逐批经 IPC 搬回主进程。
   */
  async readMessageChunk(
    kind: string,
    path: string,
    tableName: string,
    opts: { afterRid: number; maxRows?: number; startTime?: number; endTime?: number; extraCols?: string[] }
  ): Promise<{ success: boolean; rows?: any[]; lastRid?: number; done?: boolean; error?: string }> {
    if (!/^[A-Za-z0-9_]+$/.test(tableName)) {
      return { success: false, error: `非法表名: ${tableName}` }
    }

    const name2id = await this.execQuery(kind, path, "SELECT name FROM sqlite_master WHERE type='table' AND name='Name2Id'")
    const hasName2Id = !!(name2id.success && name2id.rows && name2id.rows.length > 0)

    // 附加透传列（如 packed_info_data），仅接受合法标识符
    const extraCols = (opts.extraCols || []).filter(c => /^[A-Za-z0-9_]+$/.test(c))
    let pickedExtras = extraCols

    // 列裁剪：只取导出需要的列；PRAGMA 失败时回退 m.*（仍保留就地解码与时间下推的收益）
    let selectCols = 'm.*'
    let hasCreateTime = true
    const pragma = await this.execQuery(kind, path, `PRAGMA table_info(${tableName})`)
    if (pragma.success && pragma.rows && pragma.rows.length > 0) {
      const cols = new Set(pragma.rows.map((r: any) => String(r.name)))
      hasCreateTime = cols.has('create_time')
      const wanted = [
        'local_id', 'localId', 'server_id', 'msg_svr_id', 'msgSvrId', 'MsgSvrID',
        'create_time', 'is_send', 'message_content', 'compress_content'
      ]
      pickedExtras = extraCols.filter(c => cols.has(c))
      const picked = [...new Set([...wanted.filter(c => cols.has(c)), ...MSG_TYPE_COLUMNS.filter(c => cols.has(c)), ...pickedExtras])]
      if (picked.length > 0) selectCols = picked.map(c => `m."${c}"`).join(', ')
    }

    let sql: string
    if (hasName2Id) {
      sql = `SELECT ${selectCols}, n.user_name AS sender_username, m.rowid AS __rid FROM ${tableName} m LEFT JOIN Name2Id n ON m.real_sender_id = n.rowid`
    } else {
      sql = `SELECT ${selectCols}, m.rowid AS __rid FROM ${tableName} m`
    }
    let timeCond = ''
    if (hasCreateTime && typeof opts.startTime === 'number' && typeof opts.endTime === 'number') {
      timeCond = ` AND m.create_time >= ${Math.floor(opts.startTime)} AND m.create_time <= ${Math.floor(opts.endTime)}`
    }

    const maxRows = Math.max(1, opts.maxRows || 20000)
    const out: any[] = []
    let lastRid = typeof opts.afterRid === 'number' ? opts.afterRid : -1
    let done = false
    while (out.length < maxRows) {
      const batch = await this.execQuery(kind, path, `${sql} WHERE m.rowid > ${lastRid}${timeCond} ORDER BY m.rowid ASC LIMIT 2000`)
      if (!batch.success) return { success: false, error: batch.error }
      const rows = batch.rows || []
      if (rows.length === 0) { done = true; break }
      for (const row of rows) {
        const compact: Record<string, any> = {
          __rid: row.__rid,
          local_id: row.local_id ?? row.localId ?? null,
          server_id: row.server_id ?? row.msg_svr_id ?? row.msgSvrId ?? row.MsgSvrID ?? null,
          create_time: coerceRowNumber(row.create_time, 0),
          is_send: row.is_send ?? null,
          sender_username: row.sender_username ?? null,
          localType: this.resolveLocalType(row),
          content: decodeMessageContent(row.message_content, row.compress_content)
        }
        for (const c of pickedExtras) compact[c] = row[c]
        out.push(compact)
      }
      lastRid = rows[rows.length - 1].__rid
      if (rows.length < 2000) { done = true; break }
    }
    return { success: true, rows: out, lastRid, done }
  }

  /** 兼容不同微信版本的 local_type 列名与字符串类型值 */
  private resolveLocalType(row: Record<string, any>, fallback = 1): number {
    let zeroCandidate: number | undefined
    for (const fieldName of MSG_TYPE_COLUMNS) {
      const value = getRowField(row, [fieldName])
      if (value === null || value === undefined || value === '') continue
      const parsed = coerceRowNumber(value, Number.NaN)
      if (!Number.isFinite(parsed)) continue
      if (parsed > 0) return parsed
      if (parsed === 0 && zeroCandidate === undefined) zeroCandidate = parsed
    }
    return zeroCandidate ?? fallback
  }

  async getSnsTimeline(limit: number, offset: number, usernames?: string[], keyword?: string, startTime?: number, endTime?: number): Promise<{ success: boolean; timeline?: any[]; error?: string }> {
    if (!this.initialized || this.handle === null) {
      return { success: false, error: 'WCDB 未初始化' }
    }
    try {
      if (!this.openBridge) return { success: false, error: '数据库后端尚未初始化' }
      if (!this.currentDbStoragePath) return { success: false, error: '未解析 db_storage 路径' }
      const snsPath = this.findNamedDbs(this.currentDbStoragePath, 'sns.db')[0]
      if (!snsPath) return { success: false, error: '未找到 sns.db' }

      let sql = 'SELECT tid, user_name, content FROM SnsTimeLine WHERE 1=1'
      const params: any[] = []
      if (usernames?.length) {
        sql += ` AND user_name IN (${usernames.map(() => '?').join(',')})`
        params.push(...usernames)
      }
      if (keyword) {
        sql += ' AND CAST(content AS TEXT) LIKE ?'
        params.push(`%${keyword}%`)
      }
      if (startTime) {
        sql += " AND CAST(SUBSTR(CAST(content AS TEXT), INSTR(CAST(content AS TEXT), '<createTime>') + 12, 10) AS INTEGER) >= ?"
        params.push(Math.floor(startTime))
      }
      if (endTime) {
        sql += " AND CAST(SUBSTR(CAST(content AS TEXT), INSTR(CAST(content AS TEXT), '<createTime>') + 12, 10) AS INTEGER) <= ?"
        params.push(Math.floor(endTime))
      }
      sql += ' ORDER BY tid DESC LIMIT ? OFFSET ?'
      params.push(Math.max(1, Math.min(1000, Math.floor(limit || 20))), Math.max(0, Math.floor(offset || 0)))
      const result = this.openBridge.execQueryWithParams(snsPath, sql, params, this.currentKey || undefined)
      if (!result.success) return { success: false, error: result.error }
      return {
        success: true,
        timeline: (result.rows || []).map(row => ({
          ...row,
          content: decodeMessageContent(row.content, null),
        })),
      }
    } catch (e: any) {
      return { success: false, error: e.message || String(e) }
    }
  }

  async getNativeMessages(sessionId: string, limit: number, offset: number): Promise<{ success: boolean; rows?: any[]; error?: string }> {
    return { success: false, error: 'direct native 消息读取已禁用，请使用 cursor 路径' }
  }

  // 开放 Bridge 当前不提供进程内实时监控，调用方会回退到轮询。
  setMonitor(callback: (type: string, json: string) => void): boolean {
    void callback
    return false
  }

  stopMonitor(): void {}

  // ============== 日志 / 错误码 ==============
  private async printLogs(): Promise<string> {
    return ''
  }

}
