/**
 * 我的宠物 grid: click selects (instant, like every settings control), hover animates, `···` and the
 * right-click menu offer 选用 / 在 codex-pets.net 查看 / 删除 (danger, last; bundled pets cannot be removed).
 */
import { Check, Ellipsis, ExternalLink, Trash2 } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { petPageUrl, type InstalledPet } from '@aiwc/protocol'
import { PetSprite, sourceLabel, usePrefersReducedMotion } from '@/features/pets'
import { useT } from '@/i18n'
import {
  cn,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItems,
  DropdownMenuTrigger,
  IconButton,
  type MenuSpec,
} from '@/kit'
import { openUrl } from '@/platform/openExternal'

export interface InstalledPetGridProps {
  pets: readonly InstalledPet[]
  currentId?: string
  motion: boolean
  onSelect: (pet: InstalledPet) => void
  onRemove: (pet: InstalledPet) => void
}

export function InstalledPetGrid({ pets, currentId, motion, onSelect, onRemove }: InstalledPetGridProps) {
  const t = useT()
  const [hovered, setHovered] = useState<string | undefined>(undefined)
  const reduced = usePrefersReducedMotion()

  const menuFor = (pet: InstalledPet, selected: boolean): MenuSpec => [
    {
      id: 'select',
      label: t(selected ? 'settings.pets.installed.inUse' : 'settings.pets.installed.use'),
      icon: Check,
      disabled: selected,
      onSelect: () => onSelect(pet),
    },
    ...(pet.source === 'catalog'
      ? ([
          { type: 'separator' },
          {
            id: 'site',
            label: t('settings.pets.installed.viewOnSite'),
            icon: ExternalLink,
            onSelect: () => void openUrl(petPageUrl(pet.id)),
          },
        ] satisfies MenuSpec)
      : []),
    { type: 'separator' },
    {
      id: 'remove',
      label: t('common.delete'),
      icon: Trash2,
      danger: true,
      disabled: pet.builtin,
      description: pet.builtin ? t('settings.pets.installed.builtinNoDelete') : undefined,
      onSelect: () => onRemove(pet),
    },
  ]

  return (
    <div
      role="list"
      aria-label={t('settings.pets.sections.installed')}
      className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2"
    >
      {pets.map((pet) => {
        const selected = pet.id === currentId
        const live = hovered === pet.id && motion && !reduced
        const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
          if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
          e.preventDefault()
          onSelect(pet)
        }
        return (
          <ContextMenu key={pet.id}>
            <ContextMenuTrigger asChild>
              <div
                role="listitem"
                tabIndex={0}
                aria-label={
                  selected ? t('settings.pets.installed.selected', { name: pet.displayName }) : pet.displayName
                }
                aria-current={selected || undefined}
                data-selected={selected || undefined}
                onClick={() => onSelect(pet)}
                onKeyDown={onKeyDown}
                onPointerEnter={() => setHovered(pet.id)}
                onPointerLeave={() => setHovered((h) => (h === pet.id ? undefined : h))}
                className={cn(
                  'group relative flex cursor-pointer select-none flex-col items-center gap-1 rounded-item border px-2 pb-2 pt-3 outline-none transition-colors duration-(--dur-fast)',
                  'focus-visible:ring-2 focus-visible:ring-accent/70',
                  selected ? 'border-accent-30 bg-accent-12' : 'border-line-6 hover:bg-hover-5',
                )}
              >
                <PetSprite
                  src={pet.spriteUrl}
                  version={pet.spriteVersion}
                  animation={live ? 'waving' : 'idle'}
                  playing={live}
                  scale={0.4}
                />
                <span
                  className="w-full truncate text-center text-caption font-medium leading-4 text-fg"
                  title={pet.displayName}
                >
                  {pet.displayName}
                </span>
                <span
                  className={cn(
                    'w-full truncate text-center text-micro leading-4',
                    selected ? 'text-accent' : 'text-fg-3',
                  )}
                >
                  {selected ? t('settings.pets.installed.inUse') : sourceLabel(pet)}
                </span>
                {selected ? (
                  <span
                    aria-hidden
                    className="absolute left-2 top-2 flex size-4 items-center justify-center rounded-chip bg-accent text-(--fg-on-accent)"
                  >
                    <Check size={10} strokeWidth={2.5} />
                  </span>
                ) : null}
                <div
                  className="invisible absolute right-1 top-1 group-hover:visible group-focus-within:visible"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton
                        icon={Ellipsis}
                        label={t('settings.pets.installed.more', { name: pet.displayName })}
                        size="sm"
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItems items={menuFor(pet, selected)} />
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItems items={menuFor(pet, selected)} />
            </ContextMenuContent>
          </ContextMenu>
        )
      })}
    </div>
  )
}
