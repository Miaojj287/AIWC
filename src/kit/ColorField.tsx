import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from './Popover'

export function normalizeHex(raw: string): string | undefined {
  const hex = raw.trim().replace(/^#/, '')
  if (/^[\da-f]{3}$/i.test(hex)) return `#${[...hex].map((c) => c + c).join('')}`.toLowerCase()
  if (/^[\da-f]{6}$/i.test(hex)) return `#${hex.toLowerCase()}`
}
function toHsv(hex: string) {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: h * 60, s: max === 0 ? 0 : d / max, v: max }
}
function toHex({ h, s, v }: ReturnType<typeof toHsv>) {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255).toString(16).padStart(2, '0')
  }
  return `#${channel(5)}${channel(3)}${channel(1)}`
}
/** Keep pointer traffic inside the picker; persist only completed gestures / valid text edits. */
export function ColorField({ id, label, value, onCommit }: { id: string; label: string; value: string; onCommit(value: string): void }) {
  const [hsv, setHsv] = useState(() => toHsv(value))
  const [text, setText] = useState(value.toUpperCase())
  const [invalid, setInvalid] = useState(false)
  const current = useRef(hsv)
  const committed = useRef(value)
  const frame = useRef<number | undefined>(undefined)
  const dragging = useRef(false)
  const callback = useRef(onCommit)
  callback.current = onCommit
  useEffect(() => {
    if (dragging.current) return
    committed.current = value
    current.current = toHsv(value)
    setHsv(current.current)
    setText(value.toUpperCase())
    setInvalid(false)
  }, [value])
  useEffect(() => () => { if (frame.current !== undefined) cancelAnimationFrame(frame.current) }, [])
  const commit = (hex: string) => {
    if (hex !== committed.current) { committed.current = hex; callback.current(hex) }
  }
  const paint = () => {
    frame.current = undefined
    setHsv({ ...current.current })
    setText(toHex(current.current).toUpperCase())
    setInvalid(false)
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    current.current = { ...current.current, s: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)), v: 1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)) }
    if (frame.current === undefined) frame.current = requestAnimationFrame(paint)
  }
  const finish = () => {
    dragging.current = false
    if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    paint()
    commit(toHex(current.current))
  }
  const submitText = () => {
    const hex = normalizeHex(text)
    if (!hex) { setInvalid(true); return }
    current.current = toHsv(hex)
    paint()
    commit(hex)
  }
  const color = toHex(hsv)
  const luminance = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
    .map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * ([.2126, .7152, .0722][i] ?? 0), 0)
  return <div className="flex flex-col gap-1">
    <div className="color-field" style={{ backgroundColor: color, color: luminance > .179 ? '#000000' : '#ffffff' }}>
      <Popover onOpenChange={(open) => { if (!open && dragging.current) finish() }}>
        <PopoverTrigger asChild><button type="button" className="color-field-swatch" aria-label={`${label}取色器`} /></PopoverTrigger>
        <PopoverContent align="end" className="w-[240px] p-1.5" aria-label={`${label}调色板`}>
          <div className="color-field-plane" style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
            onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); move(e) }}
            onPointerMove={(e) => { if (dragging.current) move(e) }} onPointerUp={finish} onPointerCancel={finish}>
            <span style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
          </div>
          <input type="range" aria-label={`${label}色相`} min={0} max={360} value={hsv.h} className="color-field-hue" onChange={(e) => { current.current = { ...current.current, h: Number(e.target.value) }; paint() }} onPointerDown={() => { dragging.current = true }} onPointerUp={finish} onPointerCancel={finish} onKeyUp={finish} onBlur={finish} />
          <div className="flex gap-2 pt-2">
            {(['s', 'v'] as const).map((key) => <input key={key} type="range" aria-label={`${label}${key === 's' ? '饱和度' : '明度'}`} min={0} max={100} value={Math.round(hsv[key] * 100)} className="min-w-0 flex-1 accent-accent" onChange={(e) => { current.current = { ...current.current, [key]: Number(e.target.value) / 100 }; paint() }} onPointerDown={() => { dragging.current = true }} onPointerUp={finish} onPointerCancel={finish} onKeyUp={finish} onBlur={finish} />)}
          </div>
        </PopoverContent>
      </Popover>
      <input id={id} aria-label={label} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined} spellCheck={false} value={text} maxLength={7} className="min-w-0 w-24 bg-transparent font-mono text-caption outline-none" onChange={(e) => { setText(e.target.value); setInvalid(false) }} onBlur={submitText} onKeyDown={(e) => { if (e.key === 'Enter') submitText(); if (e.key === 'Escape') { setText(value.toUpperCase()); setInvalid(false) } }} />
    </div>
    {invalid && <span id={`${id}-error`} role="alert" className="text-note text-danger">请输入 3 或 6 位十六进制色号</span>}
  </div>
}
