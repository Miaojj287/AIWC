/**
 * 常规 — appearance, UI language, launch at login, close-window behaviour. Every control applies
 * instantly (DESIGN-SPEC §2). Figma 125:415.
 */
import type { AppConfig, ShellMode } from '@aiwc/protocol'
import { Card, SegmentedControl, Select, Toggle, type SelectOption } from '@/kit'
import { LANGUAGES, LANGUAGE_NAMES, useT, type MessageKey } from '@/i18n'
import { useConfig } from '@/platform/configStore'
import { AppearanceSettings } from './AppearanceSettings'
import { saveConfig } from '../hooks'
import { PagePlaceholder, SRow, Section } from '../pageKit'

type CloseBehavior = AppConfig['general']['closeBehavior']

/** 布局 (CLAUDE.md §12): the same switch as the 「Agent 窗口」 / 「工作台」 pills, persisted in ui.shellMode. */
const LAYOUT_OPTIONS: ReadonlyArray<{ value: ShellMode; label: MessageKey }> = [
  { value: 'workbench', label: 'settings.general.layout.workbench' },
  { value: 'agent', label: 'settings.general.layout.agent' },
]

const CLOSE_OPTIONS: ReadonlyArray<{ value: CloseBehavior; label: MessageKey; description: MessageKey }> = [
  { value: 'quit', label: 'settings.general.close.quit', description: 'settings.general.close.quitDescription' },
  {
    value: 'minimize',
    label: 'settings.general.close.minimize',
    description: 'settings.general.close.minimizeDescription',
  },
  { value: 'ask', label: 'settings.general.close.ask', description: 'settings.general.close.askDescription' },
]

export function GeneralPage() {
  const t = useT()
  const general = useConfig((c) => c.general)
  const shellMode = useConfig((c) => c.ui.shellMode) ?? 'workbench'
  if (!general) return <PagePlaceholder rows={3} />
  const closeOptions: ReadonlyArray<SelectOption<CloseBehavior>> = CLOSE_OPTIONS.map((o) => ({
    value: o.value,
    label: t(o.label),
    description: t(o.description),
  }))
  return (
    <>
      <Section title={t('settings.general.sections.appearance')}>
        <AppearanceSettings general={general} />
      </Section>
      <Section title={t('settings.general.layout.section')}>
        <Card variant="rows">
          <SRow
            id="general.layout"
            title={t('settings.general.layout.title')}
            description={t('settings.general.layout.description')}
          >
            <SegmentedControl
              aria-label={t('settings.general.layout.title')}
              options={LAYOUT_OPTIONS.map((o) => ({ value: o.value, label: t(o.label) }))}
              value={shellMode}
              onValueChange={(mode) => void saveConfig({ ui: { shellMode: mode } })}
            />
          </SRow>
        </Card>
      </Section>
      <Section title={t('settings.general.language.section')}>
        <Card variant="rows">
          {/* Language names stay native (简体中文 / English) so a user who cannot read the current UI still finds theirs. */}
          <SRow id="general.language" title={t('settings.general.language.title')}>
            <SegmentedControl
              aria-label={t('settings.general.language.title')}
              options={LANGUAGES.map((value) => ({ value, label: LANGUAGE_NAMES[value] }))}
              value={general.language}
              onValueChange={(language) => void saveConfig({ general: { language } })}
            />
          </SRow>
        </Card>
      </Section>
      <Section title={t('settings.general.sections.startup')}>
        <Card variant="rows">
          <SRow id="general.launchAtLogin" title={t('settings.general.launchAtLogin')} htmlFor="general-launch">
            <Toggle
              id="general-launch"
              checked={general.launchAtLogin}
              onCheckedChange={(launchAtLogin) => void saveConfig({ general: { launchAtLogin } })}
            />
          </SRow>
          <SRow id="general.closeBehavior" title={t('settings.general.closeBehavior')} htmlFor="general-close">
            <Select
              id="general-close"
              aria-label={t('settings.general.closeBehavior')}
              options={closeOptions}
              value={general.closeBehavior}
              onValueChange={(closeBehavior) => void saveConfig({ general: { closeBehavior } })}
            />
          </SRow>
        </Card>
      </Section>
    </>
  )
}
