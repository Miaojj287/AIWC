/**
 * 宠物图库 — the codex-pets.net community gallery inside 设置 › 宠物: search, sort, pages, hover
 * previews, and 领养 as a step-list progress dialog (CLAUDE.md §4.5). Every area has its
 * loading / error / no-results state; the privacy line says exactly what goes over the network.
 */
import { ChevronLeft, ChevronRight, ExternalLink, RefreshCw, Shuffle } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PET_CATALOG_SITE,
  type CatalogPet,
  type InstalledPet,
  type PetCatalogPage,
  type PetCatalogSort,
} from '@aiwc/protocol'
import { usePrefersReducedMotion, useSpriteFrame } from '@/features/pets'
import { useLanguage, useT } from '@/i18n'
import {
  Button,
  EmptyState,
  InlineHint,
  ProgressDialog,
  SearchBox,
  Select,
  Skeleton,
  toast,
  type ProgressStep,
} from '@/kit'
import { invoke, useBridgeEvent } from '@/platform/hooks'
import { openUrl } from '@/platform/openExternal'
import {
  applyInstallStep,
  CATALOG_PAGE_SIZE,
  initialInstallSteps,
  installProgress,
  PREVIEW_FRAME,
  SORT_OPTIONS,
  wavingStripOffset,
} from './petCatalogModel'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const SEARCH_DEBOUNCE_MS = 400

type CatalogState =
  | { status: 'loading'; data?: PetCatalogPage }
  | { status: 'ready'; data: PetCatalogPage }
  | { status: 'error'; error: string; data?: PetCatalogPage }

export interface PetCatalogProps {
  currentId?: string
  motion: boolean
  /** A pet picked from the gallery: freshly adopted (`adopted`) or already on this device. */
  onUse: (pet: InstalledPet | CatalogPet, adopted: boolean) => Promise<void> | void
}

export function PetCatalog({ currentId, motion, onUse }: PetCatalogProps) {
  const t = useT()
  const language = useLanguage()
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<PetCatalogSort>('new')
  const [page, setPage] = useState(1)
  const [reloadTick, setReloadTick] = useState(0)
  const [state, setState] = useState<CatalogState>({ status: 'loading' })
  const [install, setInstall] = useState<{ pet: CatalogPet; steps: ProgressStep[] } | null>(null)
  const cancelled = useRef<string | undefined>(undefined)
  const seq = useRef(0)

  // Debounced search; Enter in the box applies at once.
  useEffect(() => {
    if (draft.trim() === query) return
    const timer = setTimeout(() => {
      setQuery(draft.trim())
      setPage(1)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft, query])

  const load = useCallback(async () => {
    const id = ++seq.current
    setState((s) => ({ status: 'loading', data: s.data }))
    try {
      const data = await invoke('pet:catalog', { page, pageSize: CATALOG_PAGE_SIZE, sort, query: query || undefined })
      if (id === seq.current) setState({ status: 'ready', data })
    } catch (e) {
      if (id === seq.current) setState((s) => ({ status: 'error', error: errText(e), data: s.data }))
    }
  }, [page, sort, query])

  useEffect(() => {
    void load()
  }, [load, reloadTick])

  // Keep the adopted marks in step with installs / removals made anywhere (the my-pets grid, the Agent panel).
  useBridgeEvent('pet:changed', (e) => {
    setState((s) =>
      s.data
        ? {
            ...s,
            data: {
              ...s.data,
              pets: s.data.pets.map((p) => (p.id === e.id ? { ...p, installed: e.reason !== 'removed' } : p)),
            },
          }
        : s,
    )
  })

  useBridgeEvent('pet:installStep', (e) => {
    setInstall((cur) => (cur && cur.pet.id === e.id ? { ...cur, steps: applyInstallStep(cur.steps, e) } : cur))
  })

  const adopt = async (pet: CatalogPet) => {
    if (pet.installed) {
      await onUse(pet, false)
      return
    }
    cancelled.current = undefined
    setInstall({ pet, steps: initialInstallSteps() })
    try {
      const installed = await invoke('pet:install', { id: pet.id })
      setInstall(null)
      await onUse(installed, true)
    } catch (e) {
      setInstall(null)
      if (cancelled.current === pet.id) toast.info(t('settings.pets.install.cancelled', { name: pet.displayName }))
      else
        toast.error(t('settings.pets.install.failed', { name: pet.displayName }), {
          detail: errText(e),
          action: { label: t('common.retry'), onClick: () => void adopt(pet) },
        })
    }
  }

  const cancelInstall = (pet: CatalogPet) => {
    cancelled.current = pet.id
    void invoke('pet:cancelInstall', { id: pet.id }).catch(() => undefined)
  }

  const clearSearch = () => {
    setDraft('')
    setQuery('')
    setPage(1)
  }

  const data = state.data
  const pets = data?.pets ?? []
  const firstLoad = state.status === 'loading' && !data
  const random = sort === 'random'
  const retry = { label: t('common.retry'), icon: RefreshCw, onClick: () => setReloadTick((n) => n + 1) }
  const openSite = {
    label: t('settings.pets.catalog.openSite'),
    icon: ExternalLink,
    onClick: () => void openUrl(PET_CATALOG_SITE),
  }

  return (
    <div className="flex flex-col gap-3" data-testid="pet-catalog">
      <div className="flex items-center gap-2">
        <SearchBox
          size="sm"
          value={draft}
          onValueChange={setDraft}
          onSubmit={(v) => {
            setQuery(v.trim())
            setPage(1)
          }}
          placeholder={t('settings.pets.catalog.searchPlaceholder')}
          aria-label={t('settings.pets.catalog.searchLabel')}
          wrapperClassName="min-w-0 flex-1"
        />
        <Select
          aria-label={t('settings.pets.catalog.sortLabel')}
          options={SORT_OPTIONS.map((o) => ({ value: o.value, label: t(o.label), description: t(o.description) }))}
          value={sort}
          onValueChange={(v) => {
            setSort(v)
            setPage(1)
          }}
          align="end"
        />
      </div>
      <InlineHint kind="info">{t('settings.pets.catalog.privacy')}</InlineHint>

      {firstLoad ? (
        <div
          className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2"
          role="status"
          aria-label={t('settings.pets.catalog.loading')}
        >
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-item border border-line-6 p-2.5">
              <Skeleton className="h-[104px] w-full rounded-control" />
              <Skeleton className="h-2.5 w-3/4 rounded-chip bg-line-10" />
              <Skeleton className="h-[26px] w-full" />
            </div>
          ))}
        </div>
      ) : state.status === 'error' && pets.length === 0 ? (
        <EmptyState
          variant="error"
          bordered
          title={t('settings.pets.catalog.loadFailed')}
          description={state.error}
          action={retry}
          secondaryAction={openSite}
        />
      ) : pets.length === 0 ? (
        query ? (
          <EmptyState
            variant="no-results"
            bordered
            title={t('settings.pets.catalog.noResults', { query })}
            description={t('settings.pets.catalog.noResultsDescription')}
            action={{ label: t('settings.pets.catalog.clearSearch'), onClick: clearSearch }}
          />
        ) : (
          <EmptyState
            bordered
            title={t('settings.pets.catalog.empty')}
            description={t('settings.pets.catalog.emptyDescription')}
            action={{ ...openSite, variant: 'ghost' }}
          />
        )
      ) : (
        <>
          {state.status === 'error' ? (
            <InlineHint kind="error">{t('settings.pets.catalog.refreshFailed', { error: state.error })}</InlineHint>
          ) : null}
          <div
            role="list"
            aria-label={t('settings.pets.sections.catalog')}
            aria-busy={state.status === 'loading' || undefined}
            className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2"
          >
            {pets.map((pet) => (
              <CatalogTile
                key={pet.id}
                pet={pet}
                current={pet.id === currentId}
                motion={motion}
                busy={install !== null}
                onAdopt={() => void adopt(pet)}
              />
            ))}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="font-latin text-micro text-fg-3">
              {random
                ? t('settings.pets.catalog.randomCount', { n: pets.length })
                : t('settings.pets.catalog.pageSummary', {
                    total: (data?.total ?? 0).toLocaleString(language),
                    page: data?.page ?? page,
                    pages: data?.totalPages ?? 1,
                  })}
            </span>
            {random ? (
              <Button
                variant="ghost"
                size="sm"
                icon={Shuffle}
                loading={state.status === 'loading'}
                onClick={() => setReloadTick((n) => n + 1)}
              >
                {t('settings.pets.catalog.shuffle')}
              </Button>
            ) : (
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={ChevronLeft}
                  disabled={page <= 1 || state.status === 'loading'}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  {t('settings.pets.catalog.previous')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  trailingIcon={ChevronRight}
                  disabled={page >= (data?.totalPages ?? 1) || state.status === 'loading'}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t('settings.pets.catalog.next')}
                </Button>
              </div>
            )}
          </div>
        </>
      )}

      <ProgressDialog
        open={install !== null}
        title={install ? t('settings.pets.install.title', { name: install.pet.displayName }) : ''}
        description={t('settings.pets.install.description')}
        value={install ? installProgress(install.steps) : undefined}
        steps={install?.steps}
        cancelLabel={t('common.cancel')}
        onCancel={install ? () => cancelInstall(install.pet) : undefined}
      />
    </div>
  )
}

function CatalogTile({
  pet,
  current,
  motion,
  busy,
  onAdopt,
}: {
  pet: CatalogPet
  current: boolean
  motion: boolean
  busy: boolean
  onAdopt: () => void
}) {
  const t = useT()
  const [hover, setHover] = useState(false)
  const [posterFailed, setPosterFailed] = useState(false)
  const reduced = usePrefersReducedMotion()
  const action = t(
    pet.installed
      ? current
        ? 'settings.pets.catalog.inUse'
        : 'settings.pets.catalog.use'
      : 'settings.pets.catalog.adopt',
  )
  return (
    <div
      role="listitem"
      aria-label={pet.displayName}
      className="group flex min-w-0 flex-col gap-2 rounded-item border border-line-6 p-2 transition-colors duration-(--dur-fast) hover:bg-hover-5"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      title={pet.description || pet.displayName}
    >
      <div className="relative flex h-[104px] items-center justify-center overflow-hidden rounded-control bg-content">
        {posterFailed ? (
          <span className="text-micro text-fg-3">{t('settings.pets.catalog.posterFailed')}</span>
        ) : (
          <img
            src={pet.posterUrl}
            alt=""
            loading="lazy"
            draggable={false}
            width={PREVIEW_FRAME.width}
            height={PREVIEW_FRAME.height}
            onError={() => setPosterFailed(true)}
            className="h-[104px] w-[96px] object-contain"
          />
        )}
        {hover && motion && !reduced && pet.previewUrl && !posterFailed ? (
          <PreviewStrip url={pet.previewUrl} version={pet.spriteVersion} />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-caption font-medium leading-4 text-fg">{pet.displayName}</span>
        <span className="truncate text-micro leading-4 text-fg-3">
          {pet.author ? t('settings.pets.catalog.by', { author: pet.author }) : 'codex-pets.net'}
        </span>
      </div>
      <Button
        size="sm"
        variant={pet.installed ? 'ghost' : 'outline'}
        className="w-full"
        disabled={busy || current}
        onClick={onAdopt}
        aria-label={t('settings.pets.catalog.tileAction', { action, name: pet.displayName })}
      >
        {action}
      </Button>
    </div>
  )
}

/** Hover preview: the waving frames of the half-size strip, laid over the poster once the strip has loaded. */
function PreviewStrip({ url, version }: { url: string; version: CatalogPet['spriteVersion'] }) {
  const [offset, setOffset] = useState<number | undefined>(undefined)
  useEffect(() => {
    if (typeof Image === 'undefined') return
    let alive = true
    const img = new Image()
    img.onload = () => alive && setOffset(wavingStripOffset(img.naturalWidth, version))
    img.src = url
    return () => {
      alive = false
    }
  }, [url, version])
  const frame = useSpriteFrame('waving', { playing: offset !== undefined })
  if (offset === undefined) return null
  return (
    <span
      aria-hidden
      className="absolute left-1/2 top-0 block -translate-x-1/2 bg-content bg-no-repeat"
      style={{
        width: PREVIEW_FRAME.width,
        height: PREVIEW_FRAME.height,
        backgroundImage: `url("${url}")`,
        backgroundPosition: `${-(offset + frame) * PREVIEW_FRAME.width}px 0`,
      }}
    />
  )
}
