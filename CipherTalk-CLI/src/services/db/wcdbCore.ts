import { basename, join } from 'path'
import { existsSync, readdirSync, statSync } from 'fs'
import { createHash } from 'node:crypto'
import { OpenWcdbBridge } from './openWcdbBridge.js'

/**
 * WcdbCore —— 直连微信加密数据库的底层封装。
 * - 不依赖 Electron `app`，可在 worker_threads 中实例化
 * - 所有资源路径通过 setPaths() 注入
 * - 仅加载由本仓库源码构建的开放 WCDB Bridge
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
  private openBridge: OpenWcdbBridge | null = null
  private openDefaultDbPath: string | null = null

  setPaths(resourcesPath: string, userDataPath: string): void {
    this.resourcesPath = resourcesPath
    this.userDataPath = userDataPath
  }

  getUserDataPath(): string | null { return this.userDataPath }

  private getOpenLibraryPath(): string {
    const override = String(process.env.CT_OPEN_WCDB_LIBRARY || '').trim()
    if (override) return override
    const baseDir = this.resourcesPath || join(process.cwd(), 'native')
    const bundled = process.platform === 'darwin'
      ? join(baseDir, 'darwin-arm64', 'libWCDBOpen.dylib')
      : join(baseDir, 'win32-x64', 'wcdb_open.dll')
    if (existsSync(bundled)) return bundled
    return process.platform === 'darwin'
      ? join(baseDir, '..', '..', 'resources', 'macos', 'libWCDBOpen.dylib')
      : join(baseDir, '..', '..', 'resources', 'wcdb_open.dll')
  }

  async initialize(): Promise<{ success: boolean; error?: string }> {
    if (this.initialized) return { success: true }

    try {
      const openLibraryPath = this.getOpenLibraryPath()
      if (!existsSync(openLibraryPath)) {
        return { success: false, error: `开放 WCDB Bridge 不存在: ${openLibraryPath}` }
      }
      const bridge = new OpenWcdbBridge()
      const result = bridge.initialize(openLibraryPath)
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
    if (depth > 6) return results
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) this.findNamedDbs(fullPath, dbName, depth + 1, results)
        else if (entry.isFile() && entry.name.toLowerCase() === dbName.toLowerCase()) results.push(fullPath)
      }
    } catch { /* ignore */ }
    return results
  }

  private findMessageDbs(dir: string, depth = 0, results: string[] = []): string[] {
    if (depth > 5) return results
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) this.findMessageDbs(fullPath, depth + 1, results)
        else if (entry.isFile() && /^(?:msg|message)_.*\.db$/i.test(entry.name)) results.push(fullPath)
      }
    } catch { /* ignore */ }
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
    if (!this.openBridge) return { success: false, errors: ['开放 WCDB Bridge 尚未初始化'] }
    for (const sessionDbPath of sessionDbPaths) {
      if (this.openBridge.canOpen(sessionDbPath, hexKey)) {
        return { success: true, handle: 1, matchedPath: sessionDbPath, errors }
      }
      errors.push(`${sessionDbPath} => 开放 WCDB Bridge 无法打开`)
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
    // 复用 open() 的连接缓存，避免重复初始化 Bridge。
    try {
      const ok = await this.open(dbPath, hexKey, wxid)
      if (!ok) {
        const logs = await this.printLogs()
        return { success: false, error: `数据库打开失败${logs ? ` | logs=${logs}` : ''}` }
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
      if (!this.openBridge) return { success: false, error: '开放 WCDB Bridge 尚未初始化' }
      const dbPath = this.resolveOpenDbPath(kind, path)
      if (!dbPath) return { success: false, error: `开放 WCDB Bridge 缺少 ${kind || '默认'} 数据库路径` }
      return this.openBridge.execQuery(dbPath, sql, this.currentKey || undefined)
    } catch (e: any) {
      return { success: false, error: e.message || String(e) }
    }
  }

  /**
   * 参数化查询。
   * 参数数组需序列化为 `[{type:'string'|'int'|'double'|'bytes'|'null', value:any}]`。
   * 开放 WCDB Bridge 直接绑定参数。
   */
  async execQueryWithParams(kind: string, path: string, sql: string, params?: any[]): Promise<{ success: boolean; rows?: any[]; error?: string }> {
    if (!this.initialized || this.handle === null) {
      return { success: false, error: 'WCDB 未初始化' }
    }
    if (!this.openBridge) return { success: false, error: '开放 WCDB Bridge 尚未初始化' }
    const dbPath = this.resolveOpenDbPath(kind, path)
    if (!dbPath) return { success: false, error: `开放 WCDB Bridge 缺少 ${kind || '默认'} 数据库路径` }
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

  async getSnsTimeline(limit: number, offset: number, usernames?: string[], keyword?: string, startTime?: number, endTime?: number): Promise<{ success: boolean; timeline?: any[]; error?: string }> {
    if (!this.initialized || this.handle === null) {
      return { success: false, error: 'WCDB 未初始化' }
    }
    try {
      if (!this.openBridge) return { success: false, error: '开放 WCDB Bridge 尚未初始化' }
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
      return result.success
        ? { success: true, timeline: result.rows || [] }
        : { success: false, error: result.error }
    } catch (e: any) {
      return { success: false, error: e.message || String(e) }
    }
  }

  async getNativeMessages(sessionId: string, limit: number, offset: number): Promise<{ success: boolean; rows?: any[]; error?: string }> {
    if (!this.initialized || this.handle === null) {
      return { success: false, error: 'WCDB 未初始化' }
    }
    if (!this.openBridge) return { success: false, error: '开放 WCDB Bridge 尚未初始化' }
    if (!this.currentDbStoragePath) return { success: false, error: '未解析 db_storage 路径' }
    const tableName = `Msg_${createHash('md5').update(sessionId).digest('hex')}`
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(Number(limit) || 50)))
    const safeOffset = Math.max(0, Math.floor(Number(offset) || 0))
    for (const dbPath of this.findMessageDbs(this.currentDbStoragePath)) {
      const tableProbe = this.openBridge.execQueryWithParams(
          dbPath,
          "SELECT name FROM sqlite_master WHERE type='table' AND lower(name)=lower(?)",
          [tableName],
          this.currentKey || undefined
      )
      if (!tableProbe.success || !tableProbe.rows?.length) continue
      const name2IdProbe = this.openBridge.execQuery(
          dbPath,
          "SELECT name FROM sqlite_master WHERE type='table' AND name='Name2Id'",
          this.currentKey || undefined
      )
      const schemaProbe = this.openBridge.execQuery(
          dbPath,
          `PRAGMA table_info("${tableName}")`,
          this.currentKey || undefined
      )
      const hasRealSenderId = !!schemaProbe.rows?.some((column: any) =>
        String(column.name || '').toLowerCase() === 'real_sender_id'
      )
      const canJoinSender = !!name2IdProbe.rows?.length && hasRealSenderId
      const sql = canJoinSender
        ? `SELECT m.*, n.user_name AS sender_username FROM "${tableName}" m LEFT JOIN Name2Id n ON m.real_sender_id=n.rowid ORDER BY m.create_time DESC LIMIT ? OFFSET ?`
        : `SELECT m.* FROM "${tableName}" m ORDER BY m.create_time DESC LIMIT ? OFFSET ?`
      const result = this.openBridge.execQueryWithParams(
        dbPath, sql, [safeLimit, safeOffset], this.currentKey || undefined
      )
      if (result.success) return { success: true, rows: result.rows || [] }
      return { success: false, error: result.error }
    }
    return { success: true, rows: [] }
  }

  async openMessageCursor(
    sessionId: string,
    batchSize: number,
    ascending: boolean,
    beginTimestamp: number,
    endTimestamp: number
  ): Promise<{ success: boolean; cursor?: number; error?: string }> {
    void sessionId; void batchSize; void ascending; void beginTimestamp; void endTimestamp
    return { success: false, error: '开放 WCDB Bridge 不提供有状态消息游标，请使用 getNativeMessages' }
  }

  async openMessageCursorLite(
    sessionId: string,
    batchSize: number,
    ascending: boolean,
    beginTimestamp: number,
    endTimestamp: number
  ): Promise<{ success: boolean; cursor?: number; error?: string }> {
    return this.openMessageCursor(sessionId, batchSize, ascending, beginTimestamp, endTimestamp)
  }

  async fetchMessageBatch(cursor: number): Promise<{ success: boolean; rows?: any[]; hasMore?: boolean; error?: string }> {
    void cursor
    return { success: false, error: '开放 WCDB Bridge 不提供有状态消息游标' }
  }

  async getMessageBatchViaCursor(
    sessionId: string,
    batchSize: number,
    ascending: boolean,
    beginTimestamp: number,
    endTimestamp: number,
    useLite: boolean = true,
    maxBatches: number = 1
  ): Promise<{ success: boolean; rows?: any[]; hasMore?: boolean; error?: string }> {
    const openRes = useLite
      ? await this.openMessageCursorLite(sessionId, batchSize, ascending, beginTimestamp, endTimestamp)
      : await this.openMessageCursor(sessionId, batchSize, ascending, beginTimestamp, endTimestamp)

    if (!openRes.success || !openRes.cursor) {
      return { success: false, error: openRes.error || '创建消息游标失败' }
    }

    try {
      const rows: any[] = []
      let hasMore = false
      const safeMaxBatches = Math.max(1, Math.min(10, Math.floor(Number(maxBatches) || 1)))

      for (let i = 0; i < safeMaxBatches; i++) {
        const batch = await this.fetchMessageBatch(openRes.cursor)
        if (!batch.success) {
          return { success: false, error: batch.error || '获取消息批次失败' }
        }

        const batchRows = Array.isArray(batch.rows) ? batch.rows : []
        rows.push(...batchRows)
        hasMore = batch.hasMore === true

        if (!hasMore || batchRows.length === 0) break
      }

      return { success: true, rows, hasMore }
    } finally {
      await this.closeMessageCursor(openRes.cursor).catch(() => undefined)
    }
  }

  async closeMessageCursor(cursor: number): Promise<{ success: boolean; error?: string }> {
    void cursor
    return { success: true }
  }

  // 开放 Bridge 当前不提供进程内实时监控，调用方可使用轮询。
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
