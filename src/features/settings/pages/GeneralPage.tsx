/**
 * 常规 — 外观, then one 偏好 card: default view, UI language, composer send key, launch at login, system notifications, close-window behaviour (one-row
 * sections only repeated their row's title). Every control applies instantly (DESIGN-SPEC §2). Figma 125:415.
 */
import { ComposerSendKeySchema, type AppConfig, type ShellMode } from '@aiwc/protocol'
import { Card, SegmentedControl, Select, Toggle, type SelectOption } from '@/kit'
import { detectMac } from '@/app/shortcuts'
import { LANGUAGES, LANGUAGE_NAMES, useT, type MessageKey } from '@/i18n'
import { useConfig } from '@/platform/configStore'
import { AppearanceSettings } from './AppearanceSettings'
import { saveConfig } from '../hooks'
import { PagePlaceholder, SRow, Section } from '../pageKit'

type CloseBehavior = AppConfig['general']['closeBehavior']

/** 默认界面 (CLAUDE.md §12): the same switch as the 「Agent 窗口」 / 「工作台」 pills, persisted in ui.shellMode. */
const LAYOUT_OPTIONS: ReadonlyArray<{ value: ShellMode; label: MessageKey }> = [
  { value: 'workbench', label: 'settings.general.layout.workbench' },
  { value: 'agent', label: 'settings.general.layout.agent' },
]

const SEND_KEY_OPTIONS = ComposerSendKeySchema.options

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
  const sendKey = useConfig((c) => c.ui.composerSendKey) ?? 'enter'
  if (!general) return <PagePlaceholder rows={3} />
  // Closing keeps the app in the Dock on macOS and in the system tray elsewhere; the label says which.
  const tray = detectMac() ? 'dock' : 'tray'
  const closeOptions: ReadonlyArray<SelectOption<CloseBehavior>> = CLOSE_OPTIONS.map((o) => ({
    value: o.value,
    label: t(o.label, { tray }),
    description: t(o.description),
  }))
  return (
    <>
      <Section title={t('settings.general.sections.appearance')}>
        <AppearanceSettings general={general} />
      </Section>
      <Section title={t('settings.general.sections.preferences')}>
        <Card variant="rows">
          <SRow id="general.layout" title={t('settings.general.layout.title')}>
            <SegmentedControl
              aria-label={t('settings.general.layout.title')}
              options={LAYOUT_OPTIONS.map((o) => ({ value: o.value, label: t(o.label) }))}
              value={shellMode}
              onValueChange={(mode) => void saveConfig({ ui: { shellMode: mode } })}
            />
          </SRow>
          {/* Language names stay native (简体中文 / English) so a user who cannot read the current UI still finds theirs. */}
          <SRow id="general.language" title={t('settings.general.language.title')}>
            <SegmentedControl
              aria-label={t('settings.general.language.title')}
              options={LANGUAGES.map((value) => ({ value, label: LANGUAGE_NAMES[value] }))}
              value={general.language}
              onValueChange={(language) => void saveConfig({ general: { language } })}
            />
          </SRow>
          <SRow
            id="general.sendKey"
            title={t('settings.general.sendKey.title')}
            description={t('settings.general.sendKey.description')}
          >
            <SegmentedControl
              aria-label={t('settings.general.sendKey.title')}
              options={SEND_KEY_OPTIONS.map((value) => ({
                value,
                label: t(`settings.general.sendKey.${value}`, { mac: detectMac() }),
              }))}
              value={sendKey}
              onValueChange={(composerSendKey) => void saveConfig({ ui: { composerSendKey } })}
            />
          </SRow>
          <SRow id="general.launchAtLogin" title={t('settings.general.launchAtLogin')} htmlFor="general-launch">
            <Toggle
              id="general-launch"
              checked={general.launchAtLogin}
              onCheckedChange={(launchAtLogin) => void saveConfig({ general: { launchAtLogin } })}
            />
          </SRow>
          <SRow
            id="general.notifications"
            title={t('settings.general.notifications.title')}
            help={t('settings.general.notifications.help')}
            htmlFor="general-notifications"
          >
            <Toggle
              id="general-notifications"
              checked={general.notifications.enabled}
              onCheckedChange={(enabled) =>
                void saveConfig({ general: { notifications: { ...general.notifications, enabled } } })
              }
            />
          </SRow>
          {general.notifications.enabled ? (
            <SRow
              id="general.notificationNames"
              title={t('settings.general.notifications.showNames')}
              description={t('settings.general.notifications.showNamesDescription')}
              htmlFor="general-notification-names"
            >
              <Toggle
                id="general-notification-names"
                checked={general.notifications.showNames}
                onCheckedChange={(showNames) =>
                  void saveConfig({ general: { notifications: { ...general.notifications, showNames } } })
                }
              />
            </SRow>
          ) : null}
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
