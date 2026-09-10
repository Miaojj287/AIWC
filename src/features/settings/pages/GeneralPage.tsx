/**
 * 常规 — theme, launch at login, close-window behaviour. Every control applies instantly (DESIGN-SPEC §2).
 * Figma 125:415.
 */
import type { AppConfig } from '@aiwc/protocol'
import { Card, Select, Toggle, type SelectOption } from '@/kit'
import { useConfig } from '@/platform/configStore'
import { AppearanceSettings } from './AppearanceSettings'
import { saveConfig } from '../hooks'
import { PagePlaceholder, SRow, Section } from '../pageKit'

type CloseBehavior = AppConfig['general']['closeBehavior']

const CLOSE_OPTIONS: ReadonlyArray<SelectOption<CloseBehavior>> = [
  { value: 'quit', label: '退出', description: '关闭窗口即退出，自动回复与推送停止' },
  { value: 'minimize', label: '最小化到菜单栏', description: '窗口隐藏，后台继续运行' },
  { value: 'ask', label: '每次询问', description: '关闭时弹出选择框，可勾选记住' },
]

export function GeneralPage() {
  const general = useConfig((c) => c.general)
  if (!general) return <PagePlaceholder rows={3} />
  return (
    <>
      <Section title="外观">
        <AppearanceSettings general={general} />
      </Section>
      <Section title="启动">
        <Card variant="rows">
          <SRow id="general.launchAtLogin" title="开机自启" description="登录系统后在后台自动启动 AIWC" htmlFor="general-launch">
            <Toggle id="general-launch" checked={general.launchAtLogin} onCheckedChange={(launchAtLogin) => void saveConfig({ general: { launchAtLogin } })} />
          </SRow>
          <SRow id="general.closeBehavior" title="关闭窗口时" description="点击窗口关闭按钮后的行为" htmlFor="general-close">
            <Select id="general-close" aria-label="关闭窗口时" options={CLOSE_OPTIONS} value={general.closeBehavior} onValueChange={(closeBehavior) => void saveConfig({ general: { closeBehavior } })} />
          </SRow>
        </Card>
      </Section>
    </>
  )
}
