import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { AppConfig } from '@aiwc/protocol'
import { ColorField } from '@/kit/ColorField'
import { Button, Card, SegmentedControl } from '@/kit'
import { DEFAULT_PALETTES, contrastRatio, paletteTokens } from '@/platform/appearance'
import { saveConfig } from '../hooks'
import { SRow } from '../pageKit'

type Mode = 'light' | 'dark'
function Preview({ mode, general }: { mode: Mode; general: AppConfig['general'] }) {
  return <div aria-hidden className="appearance-preview" style={paletteTokens(general.appearance?.[mode] ?? DEFAULT_PALETTES[mode]) as CSSProperties}>
    <div className="appearance-preview-sidebar"><i /><i /><i /></div>
    <div className="appearance-preview-body"><i /><div className="appearance-preview-card"><i /><i /><span /></div></div>
  </div>
}
function ContrastControl({ value, onCommit }: { value: number; onCommit(value: number): void }) {
  const [draft, setDraft] = useState(value)
  const latest = useRef(value)
  const saved = useRef(value)
  useEffect(() => { setDraft(value); latest.current = value; saved.current = value }, [value])
  const commit = () => {
    if (saved.current !== latest.current) { saved.current = latest.current; onCommit(latest.current) }
  }
  return <>
    <input id="appearance-contrast" type="range" min={0} max={100} value={draft} onChange={(e) => { latest.current = Number(e.target.value); setDraft(latest.current) }} onPointerUp={commit} onPointerCancel={commit} onKeyUp={commit} onBlur={commit} className="w-28 accent-accent" />
    <output className="w-6 text-right text-caption">{draft}</output>
  </>
}
export function AppearanceSettings({ general }: { general: AppConfig['general'] }) {
  const [mode, setMode] = useState<Mode>(general.theme === 'light' ? 'light' : 'dark')
  const appearance = general.appearance ?? DEFAULT_PALETTES
  const palette = appearance[mode]
  const update = (patch: Partial<typeof palette>) => void saveConfig({ general: { appearance: { ...appearance, [mode]: { ...palette, ...patch } } } })
  return <Card variant="rows">
    <SRow id="general.theme" title="主题模式" description="选择界面配色，切换后立即生效" stacked>
      <div className="grid grid-cols-3 gap-3" role="group" aria-label="主题模式">
        {(['system', 'light', 'dark'] as const).map((theme) => <button key={theme} type="button" aria-pressed={general.theme === theme} onClick={() => void saveConfig({ general: { theme } })} className="group min-w-0 rounded-item outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <div className={`relative overflow-hidden rounded-item border-2 ${general.theme === theme ? 'border-accent' : 'border-line-10 group-hover:border-fg-3'}`}>
            <Preview mode={theme === 'system' ? 'light' : theme} general={general} />
            {theme === 'system' && <div className="absolute inset-0" style={{ clipPath: 'inset(0 0 0 50%)' }}><Preview mode="dark" general={general} /></div>}
          </div><div className={`pt-2 text-caption ${general.theme === theme ? 'text-accent' : 'text-fg-2'}`}>{theme === 'system' ? '跟随系统' : theme === 'light' ? '浅色' : '深色'}</div>
        </button>)}
      </div>
    </SRow>
    <SRow id="general.appearance" title="自定义配色" description="浅色与深色分别保存；预览展示正在编辑的模式">
      <SegmentedControl aria-label="编辑配色模式" value={mode} onValueChange={setMode} options={[{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }]} />
    </SRow>
    {(['accent', 'background', 'foreground'] as const).map((key) => <SRow key={`${mode}-${key}`} id={`general.${key}`} title={{ accent: '强调色', background: '背景', foreground: '前景' }[key]} htmlFor={`appearance-${key}`}>
      <ColorField id={`appearance-${key}`} label={`${mode === 'light' ? '浅色' : '深色'}${{ accent: '强调色', background: '背景', foreground: '前景' }[key]}`} value={palette[key]} onCommit={(value) => update({ [key]: value })} />
    </SRow>)}
    <SRow id="general.contrast" title="对比度" description="调整次级文字、面板层次与分隔线的强度" htmlFor="appearance-contrast">
      <ContrastControl key={mode} value={palette.contrast} onCommit={(contrast) => update({ contrast })} />
    </SRow>
    <SRow id="general.preview" title={`${mode === 'light' ? '浅色' : '深色'}效果预览`} description={`正文对比度 ${contrastRatio(palette.foreground, palette.background).toFixed(1)}:1${contrastRatio(palette.foreground, palette.background) < 4.5 ? ' · 建议调整至 4.5:1 以上' : ''}`} stacked>
      <div style={paletteTokens(palette) as CSSProperties} className="flex flex-wrap items-center gap-3 rounded-item border border-line-10 bg-content p-4 text-fg"><span className="flex-1">这是正文 <span className="text-fg-3">与说明文字</span></span><Button variant="outline">次要操作</Button><Button>主要操作</Button></div>
      <Button variant="link" onClick={() => update(DEFAULT_PALETTES[mode])}>恢复此模式默认配色</Button>
    </SRow>
  </Card>
}
