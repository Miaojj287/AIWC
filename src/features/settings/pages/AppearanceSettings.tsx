import { useEffect, useRef, useState } from 'react'
import { DEFAULT_TRANSPARENCY, type AppConfig } from '@aiwc/protocol'
import { Button, Card, ColorField, SegmentedControl, Toggle, Tooltip } from '@/kit'
import { DEFAULT_PALETTES, contrastRatio, paletteTokens, transparencySupported } from '@/platform/appearance'
import { Trans, useT } from '@/i18n'
import { saveConfig } from '../hooks'
import { SRow } from '../pageKit'

type Mode = 'light' | 'dark'
function Preview({ mode, general }: { mode: Mode; general: AppConfig['general'] }) {
  return (
    <div
      aria-hidden
      className="appearance-preview"
      style={paletteTokens(general.appearance?.[mode] ?? DEFAULT_PALETTES[mode])}
    >
      <div className="appearance-preview-sidebar">
        <i />
        <i />
        <i />
      </div>
      <div className="appearance-preview-body">
        <i />
        <div className="appearance-preview-card">
          <i />
          <i />
          <span />
        </div>
      </div>
    </div>
  )
}
function ContrastControl({ value, onCommit }: { value: number; onCommit(value: number): void }) {
  const [draft, setDraft] = useState(value)
  const latest = useRef(value)
  const saved = useRef(value)
  useEffect(() => {
    setDraft(value)
    latest.current = value
    saved.current = value
  }, [value])
  const commit = () => {
    if (saved.current !== latest.current) {
      saved.current = latest.current
      onCommit(latest.current)
    }
  }
  return (
    <>
      <input
        id="appearance-contrast"
        type="range"
        min={0}
        max={100}
        value={draft}
        onChange={(e) => {
          latest.current = Number(e.target.value)
          setDraft(latest.current)
        }}
        onPointerUp={commit}
        onPointerCancel={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="w-28 accent-accent"
      />
      <output className="w-6 text-right text-caption">{draft}</output>
    </>
  )
}
export function AppearanceSettings({ general }: { general: AppConfig['general'] }) {
  const t = useT()
  const [mode, setMode] = useState<Mode>(general.theme === 'light' ? 'light' : 'dark')
  const appearance = general.appearance ?? DEFAULT_PALETTES
  const palette = appearance[mode]
  const update = (patch: Partial<typeof palette>) =>
    void saveConfig({ general: { appearance: { ...appearance, [mode]: { ...palette, ...patch } } } })
  const glassSupported = transparencySupported()
  const glassToggle = (
    <Toggle
      id="general-transparency"
      // Where the window cannot blur, show the switch off rather than a checked control that does nothing.
      checked={glassSupported && Boolean(general.transparency)}
      disabled={!glassSupported}
      onCheckedChange={(transparency) => void saveConfig({ general: { transparency } })}
    />
  )
  return (
    <Card variant="rows">
      <SRow id="general.theme" title={t('settings.general.appearance.theme')} stacked>
        <div className="grid grid-cols-3 gap-3" role="group" aria-label={t('settings.general.appearance.theme')}>
          {(['system', 'light', 'dark'] as const).map((theme) => (
            <button
              key={theme}
              type="button"
              aria-pressed={general.theme === theme}
              onClick={() => void saveConfig({ general: { theme } })}
              className="group min-w-0 rounded-item outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <div
                className={`relative overflow-hidden rounded-item border-2 ${general.theme === theme ? 'border-accent' : 'border-line-10 group-hover:border-fg-3'}`}
              >
                <Preview mode={theme === 'system' ? 'light' : theme} general={general} />
                {theme === 'system' && (
                  <div className="absolute inset-0" style={{ clipPath: 'inset(0 0 0 50%)' }}>
                    <Preview mode="dark" general={general} />
                  </div>
                )}
              </div>
              <div className={`truncate pt-2 text-caption ${general.theme === theme ? 'text-accent' : 'text-fg-2'}`}>
                {t(`settings.general.appearance.themes.${theme}`)}
              </div>
            </button>
          ))}
        </div>
      </SRow>
      <SRow
        id="general.transparency"
        title={t('settings.general.appearance.transparency.title')}
        description={t('settings.general.appearance.transparency.description')}
        help={t('settings.general.appearance.transparency.help')}
        htmlFor="general-transparency"
      >
        {glassSupported ? (
          glassToggle
        ) : (
          <Tooltip content={t('settings.general.appearance.transparency.unsupported')}>
            <span className="inline-flex">{glassToggle}</span>
          </Tooltip>
        )}
      </SRow>
      <SRow
        id="general.appearance"
        title={t('settings.general.appearance.custom.title')}
        description={t('settings.general.appearance.custom.description')}
        help={t('settings.general.appearance.custom.help')}
      >
        <SegmentedControl
          aria-label={t('settings.general.appearance.custom.mode')}
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'light', label: t('settings.general.appearance.themes.light') },
            { value: 'dark', label: t('settings.general.appearance.themes.dark') },
          ]}
        />
      </SRow>
      {(['accent', 'background', 'surface', 'foreground'] as const).map((key) => (
        <SRow
          key={`${mode}-${key}`}
          id={`general.${key}`}
          title={t(`settings.general.appearance.colors.${key}`)}
          htmlFor={`appearance-${key}`}
        >
          <ColorField
            id={`appearance-${key}`}
            label={t(`settings.general.appearance.colorLabels.${mode}.${key}`)}
            value={palette[key]}
            onCommit={(value) => update({ [key]: value })}
          />
        </SRow>
      ))}
      <SRow
        id="general.contrast"
        title={t('settings.general.appearance.contrast.title')}
        description={t('settings.general.appearance.contrast.description')}
        htmlFor="appearance-contrast"
      >
        <ContrastControl key={mode} value={palette.contrast} onCommit={(contrast) => update({ contrast })} />
      </SRow>
      <SRow
        id="general.preview"
        title={t(`settings.general.appearance.preview.title.${mode}`)}
        description={t(
          contrastRatio(palette.foreground, palette.background) < 4.5
            ? 'settings.general.appearance.preview.ratioLow'
            : 'settings.general.appearance.preview.ratio',
          { ratio: contrastRatio(palette.foreground, palette.background).toFixed(1) },
        )}
        stacked
      >
        <div
          style={paletteTokens(palette)}
          className="flex flex-wrap items-center gap-3 rounded-item border border-line-10 bg-content p-4 text-fg"
        >
          <span className="flex-1">
            <Trans
              k="settings.general.appearance.preview.body"
              params={{
                secondary: <span className="text-fg-3">{t('settings.general.appearance.preview.secondary')}</span>,
              }}
            />
          </span>
          <Button variant="outline">{t('settings.general.appearance.preview.secondaryAction')}</Button>
          <Button>{t('settings.general.appearance.preview.primaryAction')}</Button>
        </div>
        <Button
          variant="link"
          onClick={() =>
            // Restores this mode's colors and turns 透明效果 back on (it is part of the default appearance).
            void saveConfig({
              general: { appearance: { ...appearance, [mode]: DEFAULT_PALETTES[mode] }, transparency: DEFAULT_TRANSPARENCY },
            })
          }
        >
          {t('settings.general.appearance.preview.reset')}
        </Button>
      </SRow>
    </Card>
  )
}
