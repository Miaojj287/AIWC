/**
 * pet:* for the mock bridge (tests + browser previews). The bundled pet points at the repo's
 * resources/pets sheet; the gallery is a handful of real codex-pets.net records so previews load real
 * posters. Nothing here is used by the desktop app.
 */
import { PET_CATALOG_SORTS, type CatalogPet, type InstalledPet } from '@aiwc/protocol'
import { AbortedError, isAborted, type HandlersFor, type MockContext } from './core'

const INSTALLED_KEY = 'aiwc.mock.pets'

const asset = (path: string, id: string) => `https://codex-pets.net/assets/pets/v/${path}/${id}`

function catalogPet(
  version: string,
  id: string,
  displayName: string,
  author: string,
  description: string,
  likeCount: number,
): Omit<CatalogPet, 'installed'> {
  const base = asset(version, id)
  return {
    id,
    displayName,
    description,
    author,
    tags: [],
    spriteVersion: 2,
    posterUrl: `${base}/poster.webp`,
    previewUrl: `${base}/preview.webp`,
    spritesheetUrl: `${base}/spritesheet.webp`,
    likeCount,
    downloadCount: 0,
  }
}

const GALLERY: ReadonlyArray<Omit<CatalogPet, 'installed'>> = [
  catalogPet('1789203663260', 'apex-nessie', 'Apex Nessie', 'shawn-liang', '好奇又温柔的绿色长颈小水怪。', 10),
  catalogPet(
    '1789236704131',
    'brainfly',
    'Brainfly',
    'demetriuszhomir',
    'A brilliant fruit fly with an enormous brain.',
    1,
  ),
  catalogPet('1789201710997', 'echidna', 'Echidna', 'ayor', 'A silver-haired witch in an elegant black dress.', 12),
  catalogPet(
    '1789114333405',
    'perlica-endfield',
    'Perlica Endfield',
    'kickasuru',
    'Expressive pixel-art style with calm animations.',
    67,
  ),
  catalogPet('1789111998077', 'maomaochong', '猫猫虫', 'Jessica', 'A minimalist pixel-style cat-worm.', 56),
  catalogPet('1789098619938', 'yummyhee', 'Kaoruko Waguri', 'Yummyhee', 'A gentle, dignified chibi pet.', 62),
  catalogPet('1789074277649', 'qpet-v3', 'QPET v3', 'dan', 'Codex-size edition of the QPET v3 artwork.', 13),
  catalogPet('1789114251145', 'gugakurumiusa', 'gugakurumiusa', '080864', 'bilibili 游戏 up 主 胡桃Usa', 26),
]

function builtinPet(): InstalledPet {
  let spriteUrl = '/resources/pets/aiwcji/spritesheet.webp'
  try {
    spriteUrl = new URL('../../../resources/pets/aiwcji/spritesheet.webp', import.meta.url).href
  } catch {
    /* keep the dev-server path */
  }
  return {
    id: 'aiwcji',
    displayName: 'AIWC 鸡',
    description: '一只戴黑色爵士帽的小鸡，有低调的特工气质。',
    builtin: true,
    source: 'builtin',
    spriteVersion: 1,
    spriteUrl,
  }
}

export function petHandlers(ctx: MockContext): HandlersFor<'pet'> {
  const installs = new Map<string, AbortController>()
  const adopted = (): InstalledPet[] => ctx.kv.get<InstalledPet[]>(INSTALLED_KEY, [])
  const list = (): InstalledPet[] => [builtinPet(), ...adopted()]
  const toInstalled = (pet: Omit<CatalogPet, 'installed'>): InstalledPet => ({
    id: pet.id,
    displayName: pet.displayName,
    description: pet.description,
    builtin: false,
    source: 'catalog',
    spriteVersion: pet.spriteVersion,
    spriteUrl: pet.spritesheetUrl,
    author: pet.author,
    installedAt: ctx.now(),
  })

  return {
    'pet:list': () => list(),

    'pet:catalog': async ({ page = 1, pageSize = 30, sort = 'new', query }) => {
      await ctx.delay(350)
      const ids = new Set(list().map((p) => p.id))
      const q = query?.trim().toLowerCase()
      let pets = GALLERY.filter(
        (p) => !q || p.displayName.toLowerCase().includes(q) || p.description.toLowerCase().includes(q),
      )
      if (sort === 'popular') pets = [...pets].sort((a, b) => b.likeCount - a.likeCount)
      if (sort === 'random') pets = [...pets].sort(() => ctx.rng.next() - 0.5)
      const safeSort = PET_CATALOG_SORTS.includes(sort) ? sort : 'new'
      const start = safeSort === 'random' ? 0 : (page - 1) * pageSize
      const slice = pets.slice(start, start + pageSize).map((p) => ({ ...p, installed: ids.has(p.id) }))
      return {
        page: safeSort === 'random' ? 1 : page,
        pageSize,
        total: pets.length,
        totalPages: safeSort === 'random' ? 1 : Math.max(1, Math.ceil(pets.length / pageSize)),
        pets: slice,
      }
    },

    'pet:install': async ({ id }) => {
      const pet = GALLERY.find((p) => p.id === id)
      if (!pet) throw new Error('codex-pets.net 上找不到这只宠物')
      const abort = new AbortController()
      installs.set(id, abort)
      let step: 'download' | 'verify' | 'save' = 'download'
      try {
        for (step of ['download', 'verify', 'save'] as const) {
          ctx.emit('pet:installStep', { id, step, status: 'doing' })
          await ctx.delay(step === 'download' ? 900 : 350, abort.signal)
          ctx.emit('pet:installStep', { id, step, status: 'done' })
        }
      } catch (e) {
        ctx.emit('pet:installStep', { id, step, status: 'failed', detail: isAborted(e) ? '已取消' : String(e) })
        throw isAborted(e) ? new Error('已取消领养') : e
      } finally {
        installs.delete(id)
      }
      const installed = toInstalled(pet)
      ctx.kv.set(INSTALLED_KEY, [...adopted().filter((p) => p.id !== id), installed])
      ctx.emit('pet:changed', { reason: 'installed', id })
      return installed
    },

    'pet:cancelInstall': ({ id }) => {
      installs.get(id)?.abort(new AbortedError())
    },

    // The browser has no system file dialog behind this channel.
    'pet:import': () => null,

    'pet:remove': ({ id }) => {
      if (id === 'aiwcji') throw new Error('内置宠物不能删除')
      ctx.kv.set(
        INSTALLED_KEY,
        adopted().filter((p) => p.id !== id),
      )
      if (ctx.config().pet.current === id) {
        const cfg = ctx.config()
        ctx.setConfig({ pet: { ...cfg.pet, current: 'aiwcji' } })
      }
      ctx.emit('pet:changed', { reason: 'removed', id })
    },
  }
}
