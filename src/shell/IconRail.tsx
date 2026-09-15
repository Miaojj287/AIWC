import { Bot, CalendarClock, MessageSquare, Reply, UserRound } from 'lucide-react'
import { forwardRef, type ButtonHTMLAttributes, type CSSProperties } from 'react'
import { runCommand } from '@/app/commands'
import { shortcutLabel } from '@/app/shortcuts'
import { useT, type MessageKey } from '@/i18n'
import { Avatar, cn, ICON_STROKE, Tooltip, type IconComponent } from '@/kit'
import { useConfig } from '@/platform/configStore'
import { useAccountStatus } from '@/platform/useAccountStatus'
import { toMediaUrl } from '@/platform/mediaUrl'
import { useTabsStore } from '@/workspace/tabsStore'
import { useShellStore, type RailFunction } from './shellStore'
import './shell.css'

export interface RailFunctionMeta {
  fn: RailFunction
  labelKey: MessageKey
  icon: IconComponent
}

/** The functions, in rail order (CLAUDE.md §1; 定时任务 joined the original three). */
export const RAIL_FUNCTIONS: readonly RailFunctionMeta[] = [
  { fn: 'chat', labelKey: 'shell.rail.chat', icon: MessageSquare },
  { fn: 'autoreply', labelKey: 'shell.rail.autoreply', icon: Reply },
  { fn: 'clone', labelKey: 'shell.rail.clone', icon: Bot },
  { fn: 'tasks', labelKey: 'shell.rail.tasks', icon: CalendarClock },
]

export interface IconRailProps {
  mac: boolean
}

/**
 * IconRail — 64px shell-ground column (Figma 115:428): four 40×40 gradient tiles (r10, icon 20 in on-accent
 * white). Selected = 1px accent-30 ring + 3×22 fg indicator bar at the rail's left edge; the accent
 * drop-shadow glow is deliberately dropped (shadows are for floating layers only, CLAUDE.md §2.1) and the
 * white 55% / 14% borders are replaced by tokens. Others = 1px line-10 ring. Bottom: the current account
 * tile → 设置 Tab (same accent ring while that tab is active).
 */
export function IconRail({ mac }: IconRailProps) {
  const t = useT()
  const selected = useShellStore((s) => s.railFunction)
  const settingsActive = useTabsStore((s) => s.activeId === 'settings:settings')
  const wxid = useConfig((c) => c.account.wxid)
  const { data: status } = useAccountStatus()
  const account = status?.account
  const accountName = account?.nickname?.trim() || account?.wxid || wxid || ''

  return (
    <nav
      aria-label={t('shell.rail.nav')}
      data-testid="icon-rail"
      className="shell-rail relative flex h-full w-16 shrink-0 flex-col items-center gap-2.5 border-r border-line-6 bg-shell py-3.5"
    >
      {RAIL_FUNCTIONS.map(({ fn, labelKey, icon: Icon }) => {
        const label = t(labelKey)
        const active = fn === selected
        return (
          <div key={fn} className="relative flex w-full justify-center">
            {active ? (
              <span
                aria-hidden
                data-testid="rail-indicator"
                className="absolute left-0 top-1/2 h-[22px] w-[3px] -translate-y-1/2 rounded-r-sm bg-fg"
              />
            ) : null}
            <Tooltip content={label} kbd={shortcutLabel('rail.select', mac, { fn })} side="right">
              <RailTile
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                active={active}
                style={{ backgroundImage: `var(--rail-tile-${fn})` }}
                onClick={() => runCommand('rail.select', { fn })}
              >
                <Icon size={20} strokeWidth={ICON_STROKE} aria-hidden className="text-white" />
              </RailTile>
            </Tooltip>
          </div>
        )
      })}
      <div className="flex-1" />
      <Tooltip content={t('shell.rail.settings')} kbd={shortcutLabel('tab.openSettings', mac)} side="right">
        <RailTile
          aria-label={accountName ? t('shell.rail.accountSettings', { name: accountName }) : t('shell.rail.settings')}
          active={settingsActive}
          style={{ backgroundImage: 'var(--rail-tile-user)' }}
          onClick={() => runCommand('tab.openSettings', {})}
          data-testid="rail-account"
        >
          {accountName ? (
            <Avatar
              id={account?.wxid ?? wxid ?? ''}
              name={accountName}
              src={toMediaUrl(account?.avatarPath)}
              size={36}
              style={{ width: 40, height: 40 }}
              className="rounded-window"
            />
          ) : (
            <UserRound size={18} strokeWidth={ICON_STROKE} aria-hidden className="text-fg-2" />
          )}
        </RailTile>
      </Tooltip>
    </nav>
  )
}

interface RailTileProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  style?: CSSProperties
}

/** 40×40 r10 gradient tile — the rail is the one place (besides avatars) gradients are allowed. */
const RailTile = forwardRef<HTMLButtonElement, RailTileProps>(function RailTile(
  { active = false, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      data-active={active || undefined}
      className={cn(
        'app-no-drag inline-flex size-10 shrink-0 select-none items-center justify-center rounded-window bg-cover',
        'ring-1 transition-[filter] duration-(--dur-fast) hover:brightness-110 active:brightness-95',
        'outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
        // selected = accent 30% ring (a spread ring, never a blurred glow); rest = the 10% line token
        active ? 'ring-accent-30' : 'ring-line-10',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
})
