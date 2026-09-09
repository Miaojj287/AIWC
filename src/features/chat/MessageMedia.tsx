/**
 * Media bodies inside a bubble: image (thumb → lightbox), sticker, video poster, voice (play + 转文字),
 * file card. Paths are resolved lazily through substrate:resolveMedia and served via aiwc-media://.
 */
import { Captions, File as FileIcon, FileText, ImageOff, Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { WxMedia, WxMessage } from '@aiwc/protocol'
import { Button, ICON_STROKE, IconButton, Skeleton, Spinner, cn } from '@/kit'
import { invoke } from '@/platform/hooks'
import { formatBytes, formatVoiceDuration } from '@/platform/format'
import { toMediaUrl } from './mediaUrl'

type MediaState = { status: 'loading' } | { status: 'ready'; media: WxMedia } | { status: 'missing' } | { status: 'error'; error: string }

/** Resolve (and decrypt if needed) the media of a message once it is on screen. */
export function useResolvedMedia(message: WxMessage, enabled = true): MediaState {
  const [state, setState] = useState<MediaState>({ status: 'loading' })
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setState({ status: 'loading' })
    invoke('substrate:resolveMedia', { sessionId: message.sessionId, messageId: message.id })
      .then((media) => {
        if (cancelled) return
        setState(media ? { status: 'ready', media } : { status: 'missing' })
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ status: 'error', error: e instanceof Error ? e.message : String(e) })
      })
    return () => {
      cancelled = true
    }
  }, [message.sessionId, message.id, enabled])
  return state
}

function MediaPlaceholder({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn('flex h-[120px] w-[160px] flex-col items-center justify-center gap-1.5 rounded-item bg-line-6 text-caption text-fg-3', className)}>
      <ImageOff size={18} strokeWidth={ICON_STROKE} aria-hidden />
      <span>{label}</span>
    </div>
  )
}

export interface ImageBodyProps {
  message: WxMessage
  onOpen(src: string, alt: string): void
  /** Sticker: smaller, no lightbox chrome. */
  sticker?: boolean
}

export function ImageBody({ message, onOpen, sticker = false }: ImageBodyProps) {
  const state = useResolvedMedia(message)
  const [broken, setBroken] = useState<string[]>([])
  const label = sticker ? '表情' : '图片'
  if (state.status === 'loading') return <Skeleton className={sticker ? 'size-[96px] rounded-item' : 'h-[160px] w-[220px] rounded-item'} />
  if (state.status !== 'ready') return <MediaPlaceholder label={state.status === 'error' ? `${label}加载失败` : `${label}不可用`} className={sticker ? 'size-[96px]' : undefined} />
  const full = toMediaUrl(state.media.path) ?? toMediaUrl(state.media.thumbPath)
  const preferred = toMediaUrl(state.media.thumbPath) ?? full
  const thumb = preferred && !broken.includes(preferred) ? preferred : full && !broken.includes(full) ? full : undefined
  if (!thumb) return <MediaPlaceholder label={`${label}不可用`} />
  return (
    <button
      type="button"
      onClick={() => full && onOpen(full, label)}
      aria-label={`查看${label}`}
      className={cn('block overflow-hidden rounded-item outline-none focus-visible:ring-2 focus-visible:ring-accent/70', sticker ? 'size-[96px]' : 'max-h-[260px] max-w-[280px]')}
    >
      <img src={thumb} alt={label} draggable={false} onError={() => setBroken((paths) => [...paths, thumb])} className={cn('block object-cover', sticker ? 'size-full' : 'max-h-[260px] max-w-[280px]')} />
    </button>
  )
}

export function VideoBody({ message, onOpen }: { message: WxMessage; onOpen(src: string, alt: string): void }) {
  const state = useResolvedMedia(message)
  if (state.status === 'loading') return <Skeleton className="h-[140px] w-[240px] rounded-item" />
  if (state.status !== 'ready') return <MediaPlaceholder label="视频不可用" />
  const poster = toMediaUrl(state.media.thumbPath)
  const src = toMediaUrl(state.media.path)
  return (
    <button
      type="button"
      onClick={() => (src ?? poster) && onOpen((src ?? poster) as string, '视频')}
      aria-label="查看视频"
      className="relative block max-h-[240px] max-w-[280px] overflow-hidden rounded-item outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
    >
      {poster ? <img src={poster} alt="视频" draggable={false} className="block max-h-[240px] max-w-[280px] object-cover" /> : <MediaPlaceholder label="视频" />}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex size-9 items-center justify-center rounded-chip bg-black/50 text-white">
          <Play size={16} strokeWidth={ICON_STROKE} aria-hidden />
        </span>
      </span>
      {state.media.durationMs ? <span className="absolute bottom-1.5 right-2 rounded-control bg-black/55 px-1.5 font-latin text-micro text-white">{formatVoiceDuration(state.media.durationMs)}</span> : null}
    </button>
  )
}

export interface VoiceBodyProps {
  message: WxMessage
  self: boolean
  onTranscript?(text: string): void
}

/** Voice bubble: play / pause, duration, 转文字 (substrate:transcribeVoice) with a loading state. */
export function VoiceBody({ message, self, onTranscript }: VoiceBodyProps) {
  const state = useResolvedMedia(message)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [transcript, setTranscript] = useState<string | undefined>(message.media?.transcript)
  const [transcribing, setTranscribing] = useState(false)
  const [transcribeError, setTranscribeError] = useState<string | undefined>()
  const durationMs = (state.status === 'ready' ? state.media.durationMs : undefined) ?? message.media?.durationMs ?? 0
  const src = state.status === 'ready' ? toMediaUrl(state.media.path) : undefined

  useEffect(() => {
    if (state.status === 'ready' && state.media.transcript && !transcript) setTranscript(state.media.transcript)
  }, [state, transcript])

  useEffect(() => () => audioRef.current?.pause(), [])

  const toggle = () => {
    if (!src) return
    if (!audioRef.current) {
      const audio = new Audio(src)
      audio.addEventListener('ended', () => setPlaying(false))
      audio.addEventListener('pause', () => setPlaying(false))
      audio.addEventListener('play', () => setPlaying(true))
      audioRef.current = audio
    }
    if (playing) audioRef.current.pause()
    else void audioRef.current.play().catch(() => setPlaying(false))
  }

  const transcribe = async () => {
    setTranscribing(true)
    setTranscribeError(undefined)
    try {
      const text = await invoke('substrate:transcribeVoice', { sessionId: message.sessionId, messageId: message.id })
      setTranscript(text)
      onTranscript?.(text)
    } catch (e) {
      setTranscribeError(e instanceof Error ? e.message : String(e))
    } finally {
      setTranscribing(false)
    }
  }

  const bars = Math.max(6, Math.min(18, Math.round(durationMs / 700)))
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <IconButton
          icon={playing ? Pause : Play}
          label={playing ? '暂停' : '播放'}
          active={playing}
          disabled={!src}
          loading={state.status === 'loading'}
          onClick={toggle}
          className={cn(self && 'text-white hover:bg-white/15 hover:text-white')}
        />
        <span aria-hidden className="flex h-4 items-end gap-px">
          {Array.from({ length: bars }, (_, i) => (
            <span key={i} className={cn('w-[2px] rounded-chip', self ? 'bg-white/70' : 'bg-fg-2')} style={{ height: `${6 + ((i * 7 + message.seq) % 10)}px` }} />
          ))}
        </span>
        <span className={cn('font-latin text-caption', self ? 'text-white/85' : 'text-fg-2')}>{durationMs ? formatVoiceDuration(durationMs) : ''}</span>
        {transcript ? null : (
          <Button variant="link" size="sm" icon={Captions} loading={transcribing} onClick={() => void transcribe()} className={cn(self && 'text-white/90 hover:bg-white/10')}>
            转文字
          </Button>
        )}
      </div>
      {transcribeError ? <div className="text-note text-danger">{transcribeError}</div> : null}
      {transcript ? (
        <div className={cn('flex flex-col gap-0.5 rounded-item px-2.5 py-2 text-caption leading-[18px]', self ? 'bg-white/10 text-white/90' : 'bg-hover-5 text-fg-2')}>
          <span className={cn('flex items-center gap-1 text-micro', self ? 'text-white/60' : 'text-fg-3')}>
            <Captions size={11} strokeWidth={ICON_STROKE} aria-hidden /> 语音转文字
          </span>
          <span className="select-text whitespace-pre-wrap break-words">{transcript}</span>
        </div>
      ) : null}
    </div>
  )
}

const FILE_ICON: Record<string, typeof FileText> = { pdf: FileText, doc: FileText, docx: FileText, md: FileText, txt: FileText }

export function FileBody({ message, self }: { message: WxMessage; self: boolean }) {
  const name = message.media?.fileName ?? message.text ?? '文件'
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const Icon = FILE_ICON[ext] ?? FileIcon
  const size = message.media?.sizeBytes
  const [opening, setOpening] = useState(false)
  const open = async () => {
    setOpening(true)
    try {
      const media = await invoke('substrate:resolveMedia', { sessionId: message.sessionId, messageId: message.id })
      if (media?.path) await invoke('app:openPath', { path: media.path })
    } finally {
      setOpening(false)
    }
  }
  return (
    <button
      type="button"
      onClick={() => void open()}
      className={cn('flex min-w-[200px] max-w-[280px] items-center gap-2.5 rounded-item text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/70', self ? 'hover:bg-white/8' : 'hover:bg-hover-5')}
    >
      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-item', self ? 'bg-white/12 text-white' : 'bg-accent-15 text-accent')}>
        {opening ? <Spinner size={16} className={self ? 'text-white' : undefined} /> : <Icon size={18} strokeWidth={ICON_STROKE} aria-hidden />}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={cn('truncate text-body font-medium', self ? 'text-white' : 'text-fg')}>{name}</span>
        <span className={cn('truncate text-micro', self ? 'text-white/65' : 'text-fg-3')}>
          {[ext ? ext.toUpperCase() : undefined, size !== undefined ? formatBytes(size) : undefined].filter(Boolean).join(' · ') || '文件'}
        </span>
      </span>
    </button>
  )
}
