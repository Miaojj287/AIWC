import { parentPort } from 'worker_threads'
import { scanWindowsMemoryForImageAesKey } from './services/windowsMemoryKeyScanner'

if (!parentPort) throw new Error('imageKeyWorker must run in a worker thread')

parentPort.on('message', (message: {
  id?: number
  pids?: number[]
  ciphertext?: Uint8Array
  timeoutMs?: number
}) => {
  const id = Number(message?.id || 0)
  try {
    const pids = Array.isArray(message?.pids)
      ? message.pids.filter(pid => Number.isInteger(pid) && pid > 0)
      : []
    const ciphertext = message?.ciphertext ? Buffer.from(message.ciphertext) : Buffer.alloc(0)
    if (!pids.length || ciphertext.length !== 16) {
      parentPort!.postMessage({ id, success: false, error: 'invalid image-key scan arguments' })
      return
    }

    const timeoutMs = Math.max(5_000, Math.min(Number(message.timeoutMs) || 30_000, 60_000))
    const deadline = Date.now() + timeoutMs
    let opened = 0
    let bytes = 0
    let candidates = 0

    for (let index = 0; index < pids.length && Date.now() < deadline; index += 1) {
      const pid = pids[index]
      parentPort!.postMessage({
        id,
        progress: `正在扫描微信进程 ${index + 1}/${pids.length}（PID ${pid}）...`,
      })
      const scan = scanWindowsMemoryForImageAesKey(pid, ciphertext, deadline)
      if (scan.opened) opened += 1
      bytes += scan.bytes
      candidates += scan.candidates
      if (scan.key) {
        parentPort!.postMessage({ id, success: true, key: scan.key, opened, bytes, candidates })
        return
      }
    }

    parentPort!.postMessage({
      id,
      success: false,
      error: opened
        ? '已扫描可读取的微信进程，但未找到与当前图片匹配的 AES 密钥'
        : '无法读取微信进程内存，请尝试以管理员身份运行 AIWC',
      opened,
      bytes,
      candidates,
    })
  } catch (error) {
    parentPort!.postMessage({ id, success: false, error: String(error) })
  }
})

parentPort.postMessage({ ready: true })
