/**
 * Generated placeholder media for the mock bridge: SVG images / stickers / video posters, a silent
 * WAV so voice players work, and a QR-looking SVG for the iLink login flow. All returned as data URLs.
 */
import { hashString } from './core'

const svgUrl = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`

export type PlaceholderKind = 'image' | 'sticker' | 'video' | 'avatar'

const LABEL: Record<PlaceholderKind, string> = { image: '图片', sticker: '表情', video: '视频', avatar: '' }

export function placeholderSvg(kind: PlaceholderKind, seed: string, width = 640, height = 480): string {
  const h = hashString(`${kind}:${seed}`)
  const hue = h % 360
  const hue2 = (hue + 40 + (h >> 8) % 60) % 360
  const bg = `hsl(${hue} 28% 22%)`
  const fg = `hsl(${hue2} 45% 55%)`
  const cx = 20 + ((h >> 4) % 60)
  const cy = 25 + ((h >> 10) % 50)
  const r = 12 + ((h >> 16) % 18)
  const shapes =
    kind === 'sticker'
      ? `<circle cx="50%" cy="48%" r="30%" fill="${fg}"/><circle cx="42%" cy="42%" r="4%" fill="${bg}"/><circle cx="58%" cy="42%" r="4%" fill="${bg}"/><path d="M ${width * 0.4} ${height * 0.6} Q ${width * 0.5} ${height * 0.7} ${width * 0.6} ${height * 0.6}" stroke="${bg}" stroke-width="${Math.max(2, width / 60)}" fill="none" stroke-linecap="round"/>`
      : `<circle cx="${cx}%" cy="${cy}%" r="${r}%" fill="${fg}" opacity="0.85"/><rect x="${(cx + 30) % 70}%" y="${(cy + 35) % 60}%" width="22%" height="18%" rx="${width / 40}" fill="${fg}" opacity="0.55"/>`
  const play =
    kind === 'video'
      ? `<circle cx="50%" cy="50%" r="${Math.min(width, height) * 0.12}" fill="rgba(0,0,0,0.45)"/><path d="M ${width * 0.47} ${height * 0.43} L ${width * 0.56} ${height * 0.5} L ${width * 0.47} ${height * 0.57} Z" fill="#fff"/>`
      : ''
  const label = LABEL[kind]
    ? `<text x="${width - 12}" y="${height - 12}" text-anchor="end" font-family="-apple-system, PingFang SC, sans-serif" font-size="${Math.max(11, width / 30)}" fill="rgba(255,255,255,0.55)">${LABEL[kind]}</text>`
    : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" rx="${kind === 'avatar' ? width / 4 : 0}" fill="${bg}"/>${shapes}${play}${label}</svg>`
  return svgUrl(svg)
}

/** Silent 8 kHz mono 8-bit PCM WAV, capped at 3 s so the data URL stays small. */
export function silentWav(durationMs: number): string {
  const seconds = Math.min(3, Math.max(0.2, durationMs / 1000))
  const sampleRate = 8000
  const samples = Math.round(sampleRate * seconds)
  const bytes = new Uint8Array(44 + samples)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[offset + i] = s.charCodeAt(i)
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate, true) // byte rate (8-bit mono)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  ascii(36, 'data')
  view.setUint32(40, samples, true)
  bytes.fill(128, 44) // 8-bit silence is 0x80
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:audio/wav;base64,${btoa(bin)}`
}

/** A QR-code-looking 25×25 module grid (not scannable — the login is mocked anyway). */
export function qrPlaceholderSvg(seed: string, size = 220): string {
  const n = 25
  const cell = size / n
  let h = hashString(seed)
  const nextBit = () => {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0
    return (h >>> 16) & 1
  }
  const inFinder = (x: number, y: number) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7)
  let rects = ''
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (inFinder(x, y)) continue
      if (nextBit()) rects += `<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}"/>`
    }
  }
  const finder = (ox: number, oy: number) =>
    `<rect x="${ox * cell}" y="${oy * cell}" width="${7 * cell}" height="${7 * cell}"/><rect x="${(ox + 1) * cell}" y="${(oy + 1) * cell}" width="${5 * cell}" height="${5 * cell}" fill="#fff"/><rect x="${(ox + 2) * cell}" y="${(oy + 2) * cell}" width="${3 * cell}" height="${3 * cell}"/>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${finder(0, 0)}${finder(n - 7, 0)}${finder(0, n - 7)}${rects}</g></svg>`
  return svgUrl(svg)
}

/** Plain-text stand-in for a shared file. */
export function textFileUrl(name: string, body: string): string {
  return `data:text/plain;charset=utf-8,${encodeURIComponent(`${name}\n\n${body}`)}`
}
