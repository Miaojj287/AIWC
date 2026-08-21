import { closeSync, existsSync, openSync, readdirSync, readSync } from 'fs'
import { join } from 'path'
import { extractMemoryDbKeyCandidates } from './memoryDbKeyPattern'

export interface MacosMemoryKeyScanResult {
  key: string | null
  dbOk: boolean
  saltCount: number
  regions: number
  bytes: number
  attached: boolean
  error?: string
}

function collectEncryptedDbSalts(rootPath: string): Set<string> {
  const salts = new Set<string>()
  let visited = 0
  const walk = (dir: string, depth: number) => {
    if (depth > 6 || visited >= 1000) return
    let entries: import('fs').Dirent[]
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (visited >= 1000) break
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1)
        continue
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.db')) continue
      visited += 1
      let fd: number | null = null
      try {
        fd = openSync(fullPath, 'r')
        const head = Buffer.alloc(16)
        if (readSync(fd, head, 0, head.length, 0) !== head.length) continue
        if (head.subarray(0, 15).equals(Buffer.from('SQLite format 3'))) continue
        salts.add(head.toString('hex'))
      } catch {
        // ignore unreadable database candidates
      } finally {
        if (fd !== null) closeSync(fd)
      }
    }
  }
  if (existsSync(rootPath)) walk(rootPath, 0)
  return salts
}

/** Read-only macOS Mach scan for WCDB x'<raw key><salt>' records. */
export async function scanMacosMemoryForDbKey(
  pid: number,
  dbRootPath: string,
  onProgress?: (bytes: number, regions: number) => void
): Promise<MacosMemoryKeyScanResult> {
  const salts = collectEncryptedDbSalts(dbRootPath)
  const result: MacosMemoryKeyScanResult = {
    key: null,
    dbOk: salts.size > 0,
    saltCount: salts.size,
    regions: 0,
    bytes: 0,
    attached: false,
  }
  if (process.platform !== 'darwin') return { ...result, error: 'macOS only' }
  if (pid <= 0 || salts.size === 0) return result

  try {
    const koffi = require('koffi')
    const lib = koffi.load('/usr/lib/libSystem.B.dylib')
    const machTaskSelf = lib.func('mach_task_self', 'uint32', [])
    const taskForPid = lib.func('task_for_pid', 'int', ['uint32', 'int', koffi.out('uint32*')])
    const machVmRegion = lib.func('mach_vm_region', 'int', [
      'uint32', koffi.out('uint64*'), koffi.out('uint64*'), 'int', 'void*', koffi.out('uint32*'), koffi.out('uint32*')
    ])
    const machVmReadOverwrite = lib.func('mach_vm_read_overwrite', 'int', [
      'uint32', 'uint64', 'uint64', 'void*', koffi.out('uint64*')
    ])
    const machPortDeallocate = lib.func('mach_port_deallocate', 'int', ['uint32', 'uint32'])

    const selfTask = machTaskSelf()
    const taskBuf = Buffer.alloc(4)
    const attachKr = taskForPid(selfTask, pid, taskBuf)
    const task = taskBuf.readUInt32LE(0)
    if (attachKr !== 0 || !task) return { ...result, error: `task_for_pid failed: ${attachKr}` }
    result.attached = true

    try {
      const VM_PROT_READ = 0x1
      const VM_PROT_WRITE = 0x2
      const INFO_FLAVOR = 9
      const INFO_COUNT = 9
      const MAX_REGION_SIZE = 512 * 1024 * 1024
      const CHUNK_SIZE = 2 * 1024 * 1024
      const OVERLAP = 98
      let address = 0

      while (address < 0x7fff_ffff_ffff) {
        const addrBuf = Buffer.alloc(8)
        addrBuf.writeBigUInt64LE(BigInt(address), 0)
        const sizeBuf = Buffer.alloc(8)
        const infoBuf = Buffer.alloc(64)
        const countBuf = Buffer.alloc(4)
        countBuf.writeUInt32LE(INFO_COUNT, 0)
        const objectBuf = Buffer.alloc(4)
        const regionKr = machVmRegion(task, addrBuf, sizeBuf, INFO_FLAVOR, infoBuf, countBuf, objectBuf)
        if (regionKr !== 0) break
        const base = Number(addrBuf.readBigUInt64LE(0))
        const size = Number(sizeBuf.readBigUInt64LE(0))
        const protection = infoBuf.readInt32LE(0)
        const objectName = objectBuf.readUInt32LE(0)
        if (objectName) {
          try { machPortDeallocate(selfTask, objectName) } catch { }
        }

        if ((protection & VM_PROT_READ) && (protection & VM_PROT_WRITE) && size > 0 && size <= MAX_REGION_SIZE) {
          result.regions += 1
          let offset = 0
          let trailing = Buffer.alloc(0)
          while (offset < size) {
            const requested = Math.min(CHUNK_SIZE, size - offset)
            const chunk = Buffer.allocUnsafe(requested)
            const outSizeBuf = Buffer.alloc(8)
            const readKr = machVmReadOverwrite(task, base + offset, requested, chunk, outSizeBuf)
            offset += requested
            const actual = Number(outSizeBuf.readBigUInt64LE(0))
            if (readKr !== 0 || actual <= 0) {
              trailing = Buffer.alloc(0)
              continue
            }
            result.bytes += actual
            const current = chunk.subarray(0, actual)
            const searchable = trailing.length ? Buffer.concat([trailing, current]) : current
            const matched = extractMemoryDbKeyCandidates(searchable).find(candidate => salts.has(candidate.salt))
            if (matched) {
              result.key = matched.key
              return result
            }
            trailing = searchable.subarray(Math.max(0, searchable.length - OVERLAP))
          }
          if (result.regions % 20 === 0) {
            onProgress?.(result.bytes, result.regions)
            await new Promise(resolve => setTimeout(resolve, 1))
          }
        }
        const next = base + size
        if (next <= address) break
        address = next
      }
    } finally {
      try { machPortDeallocate(selfTask, task) } catch { }
    }
    return result
  } catch (error: any) {
    return { ...result, error: error?.message || String(error) }
  }
}
