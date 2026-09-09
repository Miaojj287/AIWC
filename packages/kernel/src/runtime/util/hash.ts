/** FNV-1a 64-bit (as two 32-bit lanes) → 16 hex chars. Stable across runs; used for prompt cache keys. */
export function fnv1a64(text: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 ^= c
    h1 = Math.imul(h1, 0x01000193) >>> 0
    h2 ^= c
    h2 = Math.imul(h2, 0x2f0f0f0f) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}
