import { forwardRef, useState, type CSSProperties, type HTMLAttributes } from 'react'
import { cn } from './cn'

export type AvatarSize = 20 | 28 | 36 | 44 | 56 | 64

export interface AvatarMember {
  id: string
  name: string
  src?: string
}

export interface AvatarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Stable id (wxid / contact id) — picks one of the 8 gradient tiles deterministically. */
  id: string
  name: string
  src?: string
  size?: AvatarSize
  /** Group chat: 3×3 mosaic of the first members (WeChat style). Cells are tiles / images only — no initials. */
  members?: AvatarMember[]
  /** Square corners on a rail / settings tile instead of r8. */
  square?: boolean
}

/** FNV-1a over the id → 0..7. Same id, same tile, on every machine. */
export function avatarTileIndex(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % 8
}

/** First grapheme, upper-cased for Latin. */
export function avatarInitial(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  const first = Array.from(trimmed)[0] ?? '?'
  return first.toUpperCase()
}

const tileStyle = (id: string): CSSProperties => ({ backgroundImage: `var(--avatar-tile-${avatarTileIndex(id)})` })

/** Initial size per avatar size — type scale only (11 / 12 / 14 / 20 / 22 px), never an off-scale px. */
const FONT: Record<AvatarSize, string> = {
  20: 'text-micro',
  28: 'text-caption',
  36: 'text-bubble',
  44: 'text-title',
  56: 'text-wizard',
  64: 'text-wizard',
}

/**
 * Avatar — 36 / 28 / 20 (+44 / 56 / 64 for headers), r8. Image with fallback to the initial letter on one of
 * eight muted gradient tiles derived from `id` (the only place gradients are allowed besides the rail).
 * `members` renders the group mosaic (2×2 up to 4 members, else 3×3): r4 cells that are coloured tiles or
 * images only — initials would be unreadable below 11px, so cells never carry text. Figma: 会话列表 / 会话头部.
 */
export const Avatar = forwardRef<HTMLDivElement, AvatarProps>(function Avatar(
  { id, name, src, size = 36, members, square = false, className, style, ...rest },
  ref,
) {
  const [broken, setBroken] = useState<string>()
  const showImage = Boolean(src) && broken !== src
  const radius = square ? 'rounded-control' : size <= 20 ? 'rounded-control' : 'rounded-item'

  if (!showImage && members && members.length > 0) {
    const cells = members.slice(0, 9)
    const cols = cells.length <= 1 ? 1 : cells.length <= 4 ? 2 : 3
    return (
      <div
        ref={ref}
        role="img"
        aria-label={name}
        className={cn('grid shrink-0 gap-px overflow-hidden bg-line-8 p-px', radius, className)}
        style={{ width: size, height: size, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, ...style }}
        {...rest}
      >
        {cells.map((m) => (
          <MemberCell key={m.id} member={m} />
        ))}
      </div>
    )
  }

  return (
    <div
      ref={ref}
      role="img"
      aria-label={name}
      className={cn(
        'flex shrink-0 select-none items-center justify-center overflow-hidden font-medium text-(--fg-on-accent)/90',
        radius,
        FONT[size],
        className,
      )}
      style={{ width: size, height: size, ...(showImage ? {} : tileStyle(id)), ...style }}
      {...rest}
    >
      {showImage ? (
        <img src={src} alt="" draggable={false} onError={() => setBroken(src)} className="size-full object-cover" />
      ) : (
        <span aria-hidden>{avatarInitial(name)}</span>
      )}
    </div>
  )
})

/** One mosaic cell: the member's image, or their hashed gradient tile. Never text. */
function MemberCell({ member }: { member: AvatarMember }) {
  const [broken, setBroken] = useState<string>()
  const showImage = Boolean(member.src) && broken !== member.src
  return (
    <div className="min-h-0 min-w-0 overflow-hidden rounded-sm" style={showImage ? undefined : tileStyle(member.id)} aria-hidden>
      {showImage ? <img src={member.src} alt="" draggable={false} onError={() => setBroken(member.src)} className="size-full object-cover" /> : null}
    </div>
  )
}
