/**
 * 当前宠物 preview: a stage with the live sprite plus chips that replay each state the Agent can put it
 * in, so the user sees what 需要你确认 / 完成了 / 出错了 look like before they happen.
 */
import { useState } from 'react'
import type { InstalledPet } from '@aiwc/protocol'
import { animationFor, PetSprite, sourceLabel, usePrefersReducedMotion, type PetAnimationId } from '@/features/pets'
import { useT, type MessageKey } from '@/i18n'
import { Badge, Chip } from '@/kit'

const MOVES: ReadonlyArray<{ id: PetAnimationId; label: MessageKey }> = [
  { id: 'idle', label: 'settings.pets.preview.moves.idle' },
  { id: 'running', label: 'settings.pets.preview.moves.running' },
  { id: 'waiting', label: 'settings.pets.preview.moves.waiting' },
  { id: 'review', label: 'settings.pets.preview.moves.review' },
  { id: 'failed', label: 'settings.pets.preview.moves.failed' },
  { id: 'waving', label: 'settings.pets.preview.moves.waving' },
  { id: 'jumping', label: 'settings.pets.preview.moves.jumping' },
  { id: 'look-left', label: 'settings.pets.preview.moves.lookLeft' },
  { id: 'look-right', label: 'settings.pets.preview.moves.lookRight' },
]

export function CurrentPetPreview({ pet, motion }: { pet: InstalledPet; motion: boolean }) {
  const t = useT()
  const [move, setMove] = useState<PetAnimationId>('idle')
  const reduced = usePrefersReducedMotion()
  const moves = MOVES.filter((m) => animationFor(m.id, pet.spriteVersion) === m.id)
  const current = moves.some((m) => m.id === move) ? move : 'idle'
  return (
    <div className="flex items-center gap-4" data-testid="current-pet-preview">
      <div className="flex size-[132px] shrink-0 items-center justify-center rounded-item border border-line-6 bg-content">
        <PetSprite
          key={pet.id}
          src={pet.spriteUrl}
          version={pet.spriteVersion}
          animation={current}
          scale={0.6}
          playing={motion && !reduced}
          label={t('settings.pets.preview.label', { name: pet.displayName })}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-body font-medium leading-5 text-fg">{pet.displayName}</span>
          <Badge tone={pet.builtin ? 'accent' : 'neutral'}>{sourceLabel(pet)}</Badge>
        </div>
        <p className="line-clamp-2 text-note leading-4 text-fg-3">
          {pet.description || t('settings.pets.preview.noDescription')}
        </p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('settings.pets.preview.group')}>
          {moves.map((m) => (
            <Chip key={m.id} label={t(m.label)} selected={current === m.id} onClick={() => setMove(m.id)} />
          ))}
        </div>
        {!motion || reduced ? (
          <span className="text-micro text-fg-3">
            {t(reduced ? 'settings.pets.preview.reducedMotion' : 'settings.pets.preview.motionOff')}
          </span>
        ) : null}
      </div>
    </div>
  )
}
