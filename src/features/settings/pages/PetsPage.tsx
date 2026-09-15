/**
 * 宠物 — the Codex-style companion that perches on the Agent composer (DESIGN-SPEC §2 宠物).
 * 当前宠物 (preview + instant toggles) → 我的宠物 (select / import / delete) → 宠物图库 (codex-pets.net).
 * Pets live in <dataRoot>/pets; the only network traffic is the gallery and 领养 downloads.
 */
import { FolderInput, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import type { CatalogPet, InstalledPet, PetConfig } from '@aiwc/protocol'
import { resolveCurrentPet, useInstalledPets, usePetStore, usePrefersReducedMotion } from '@/features/pets'
import { useT, type MessageKey } from '@/i18n'
import { Button, Card, DangerDialog, EmptyState, SegmentedControl, SkeletonListRows, Toggle, toast } from '@/kit'
import { useConfig } from '@/platform/configStore'
import { invoke } from '@/platform/hooks'
import { errorMessage, refreshConfig, saveConfig } from '../hooks'
import { PagePlaceholder, SRow, Section } from '../pageKit'
import { CurrentPetPreview } from './pets/CurrentPetPreview'
import { InstalledPetGrid } from './pets/InstalledPetGrid'
import { PetCatalog } from './pets/PetCatalog'

const SIZE_OPTIONS: ReadonlyArray<{ value: PetConfig['size']; label: MessageKey }> = [
  { value: 'sm', label: 'settings.pets.size.sm' },
  { value: 'md', label: 'settings.pets.size.md' },
  { value: 'lg', label: 'settings.pets.size.lg' },
]

export function PetsPage() {
  const t = useT()
  const config = useConfig((c) => c.pet)
  const { pets, loaded, error } = useInstalledPets()
  const reduced = usePrefersReducedMotion()
  const [importing, setImporting] = useState(false)
  const [removing, setRemoving] = useState<InstalledPet | null>(null)

  if (!config) return <PagePlaceholder rows={4} />
  const current = resolveCurrentPet(pets, config)
  const motion = config.motion && !reduced
  const reloadPets = () => void usePetStore.getState().load()

  /** Make `pet` the current pet; `announce` is the toast title when the change came from an adopt / import. */
  const select = async (pet: Pick<InstalledPet, 'id'>, announce?: string) => {
    const ok = await saveConfig({ pet: { current: pet.id, enabled: true } })
    if (ok && announce) toast.success(announce, { detail: t('settings.pets.toast.withYou') })
  }

  const useFromCatalog = async (pet: InstalledPet | CatalogPet, adopted: boolean) => {
    if (adopted) await usePetStore.getState().load()
    await select(
      pet,
      t(adopted ? 'settings.pets.toast.adopted' : 'settings.pets.toast.switched', { name: pet.displayName }),
    )
  }

  const importZip = async () => {
    setImporting(true)
    try {
      const pet = await invoke('pet:import', undefined)
      if (!pet) return
      await usePetStore.getState().load()
      await select(pet, t('settings.pets.toast.imported', { name: pet.displayName }))
    } catch (e) {
      toast.error(t('settings.pets.toast.importFailed'), { detail: errorMessage(e) })
    } finally {
      setImporting(false)
    }
  }

  const remove = async (pet: InstalledPet) => {
    try {
      await invoke('pet:remove', { id: pet.id })
      await Promise.all([usePetStore.getState().load(), refreshConfig()])
      setRemoving(null)
      toast.success(t('settings.pets.toast.removed', { name: pet.displayName }))
    } catch (e) {
      toast.error(t('settings.pets.toast.removeFailed'), { detail: errorMessage(e) })
    }
  }

  return (
    <>
      <Section title={t('settings.pets.sections.current')}>
        <Card variant="rows">
          <SRow
            id="pets.current"
            title={t('settings.pets.current.title')}
            description={t('settings.pets.current.description')}
            stacked
          >
            {current ? (
              <CurrentPetPreview pet={current} motion={config.motion} />
            ) : !loaded ? (
              <SkeletonListRows rows={1} />
            ) : (
              <EmptyState
                compact
                title={t('settings.pets.current.empty')}
                description={
                  error ? t('settings.pets.current.loadFailed', { error }) : t('settings.pets.current.emptyDescription')
                }
                action={error ? { label: t('common.retry'), icon: RefreshCw, onClick: reloadPets } : undefined}
              />
            )}
          </SRow>
          <SRow
            id="pets.enabled"
            title={t('settings.pets.enabled.title')}
            description={t('settings.pets.enabled.description')}
            htmlFor="pets-enabled"
          >
            <Toggle
              id="pets-enabled"
              checked={config.enabled}
              onCheckedChange={(enabled) => void saveConfig({ pet: { enabled } })}
            />
          </SRow>
          <SRow
            id="pets.bubbles"
            title={t('settings.pets.bubbles.title')}
            description={t('settings.pets.bubbles.description')}
            htmlFor="pets-bubbles"
            disabled={!config.enabled}
          >
            <Toggle
              id="pets-bubbles"
              checked={config.bubbles}
              onCheckedChange={(bubbles) => void saveConfig({ pet: { bubbles } })}
            />
          </SRow>
          <SRow
            id="pets.motion"
            title={t('settings.pets.motion.title')}
            description={t(reduced ? 'settings.pets.motion.reduced' : 'settings.pets.motion.description')}
            htmlFor="pets-motion"
            disabled={!config.enabled}
          >
            <Toggle
              id="pets-motion"
              checked={config.motion}
              onCheckedChange={(value) => void saveConfig({ pet: { motion: value } })}
            />
          </SRow>
          <SRow
            id="pets.idleFlair"
            title={t('settings.pets.idleFlair.title')}
            description={t('settings.pets.idleFlair.description')}
            htmlFor="pets-flair"
            disabled={!config.enabled || !motion}
          >
            <Toggle
              id="pets-flair"
              checked={config.idleFlair}
              onCheckedChange={(idleFlair) => void saveConfig({ pet: { idleFlair } })}
            />
          </SRow>
          <SRow
            id="pets.size"
            title={t('settings.pets.size.title')}
            description={t('settings.pets.size.description')}
            disabled={!config.enabled}
          >
            <SegmentedControl
              aria-label={t('settings.pets.size.title')}
              options={SIZE_OPTIONS.map((o) => ({ value: o.value, label: t(o.label) }))}
              value={config.size}
              onValueChange={(size) => void saveConfig({ pet: { size } })}
            />
          </SRow>
        </Card>
      </Section>

      <Section
        title={t('settings.pets.sections.installed')}
        aside={loaded && pets.length ? t('settings.pets.installed.count', { n: pets.length }) : undefined}
      >
        <Card variant="rows">
          <SRow
            id="pets.installed"
            title={t('settings.pets.sections.installed')}
            description={t('settings.pets.installed.description')}
          >
            <Button variant="outline" icon={FolderInput} loading={importing} onClick={() => void importZip()}>
              {t('settings.pets.installed.import')}
            </Button>
          </SRow>
          <div className="p-4">
            {!loaded ? (
              <SkeletonListRows rows={2} />
            ) : error && pets.length === 0 ? (
              <EmptyState
                compact
                variant="error"
                title={t('settings.pets.installed.loadFailed')}
                description={error}
                action={{ label: t('common.retry'), icon: RefreshCw, onClick: reloadPets }}
              />
            ) : pets.length === 0 ? (
              <EmptyState
                compact
                title={t('settings.pets.installed.empty')}
                description={t('settings.pets.installed.emptyDescription')}
              />
            ) : (
              <InstalledPetGrid
                pets={pets}
                currentId={current?.id}
                motion={motion}
                onSelect={(pet) => void select(pet)}
                onRemove={setRemoving}
              />
            )}
          </div>
        </Card>
      </Section>

      <Section title={t('settings.pets.sections.catalog')} aside={t('settings.pets.catalog.aside')}>
        <Card variant="rows">
          <SRow
            id="pets.catalog"
            title={t('settings.pets.sections.catalog')}
            description={t('settings.pets.catalog.description')}
          />
          <div className="p-4">
            <PetCatalog currentId={current?.id} motion={motion} onUse={useFromCatalog} />
          </div>
        </Card>
      </Section>

      <DangerDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing ? t('settings.pets.remove.title', { name: removing.displayName }) : ''}
        description={t(
          removing && removing.id === current?.id
            ? 'settings.pets.remove.currentDescription'
            : 'settings.pets.remove.description',
        )}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => (removing ? remove(removing) : undefined)}
      />
    </>
  )
}
