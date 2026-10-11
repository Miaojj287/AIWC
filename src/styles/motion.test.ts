import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const motion = read('../kit/kit.css')
const tokens = read('./tokens.css')

describe('desktop motion contract', () => {
  it('never animates layout or repeats the dialog centering translation', () => {
    expect(motion).not.toMatch(/transition:\s*all\b|\s+ease-in[;\s]/)
    const dialogKeyframes = motion.slice(
      motion.indexOf('@keyframes kit-pop-in'),
      motion.indexOf('@keyframes kit-slide-in-right'),
    )
    expect(dialogKeyframes).not.toContain('translate(')
    expect(motion).not.toContain('kit-toast-in')
    expect(read('../kit/ProgressBar.tsx')).not.toContain('transition-[width]')
    expect(tokens).toContain('--ease-out: cubic-bezier(0.23, 1, 0.32, 1)')
  })

  it('provides static loading and switch movement with reduced motion while preserving fading feedback', () => {
    const reduced = motion.slice(motion.indexOf('@media (prefers-reduced-motion: reduce)'))
    // Busy glyphs keep breathing (opacity only) instead of freezing into a broken-looking icon.
    expect(reduced).toContain('.animate-spin { animation: kit-breathe')
    expect(reduced).toContain('.animate-pulse { animation: none; }')
    expect(reduced).toContain(".kit-progress-fill, [role='switch'] > *, .kit-scrollbar { transition: none; }")
    expect(reduced).toContain('animation: kit-fade-in')
    expect(reduced).not.toContain('translateX(')
    expect(motion).toContain(":root[data-input='keyboard']")
  })

  it('keeps keyboard-driven surfaces on a named animation so Radix Presence can still unmount them', () => {
    // `animation: none` would leave a closing dialog and its scrim on screen after a keypress mid-exit.
    const keyboard = /:root\[data-input='keyboard'\][^{]*\{([^}]*)\}/.exec(motion)?.[1] ?? ''
    expect(keyboard).not.toMatch(/animation:\s*none/)
    expect(keyboard).toContain('animation-duration: 0.01ms')
    // Toasts and control hover colours are not keyboard actions; they keep their transitions.
    expect(motion).not.toContain(":root[data-input='keyboard'] .kit-toast")
    expect(motion).not.toContain(":root[data-input='keyboard'] :is(button")
  })

  it('defines independent contrast and transparency fallbacks', () => {
    const accessibility = read('./accessibility.css')
    expect(accessibility).toContain('(forced-colors: active)')
    expect(accessibility).toContain('CanvasText')
    expect(accessibility).toContain(':focus-visible')
    expect(read('../shell/shell.css')).toContain('(prefers-reduced-transparency: reduce)')
  })
})
