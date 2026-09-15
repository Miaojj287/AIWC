/**
 * AI 宠物 service (main process): the pets folder under the data root, the bundled pets, the
 * codex-pets.net catalog and the two install paths (领养 from the catalog / 导入 a downloaded zip).
 *
 * Every sheet is validated by its header before anything is written (petAssets), ids are slugs only,
 * catalog URLs must be https on codex-pets.net, and the renderer only ever gets `aiwc-media://` URLs
 * under `<dataRoot>/pets` (docs/ARCHITECTURE.md §8). Pure fs + fetch — no `electron` import.
 */
import { cp, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import {
  isValidPetId,
  PET_CATALOG_SITE,
  PET_CATALOG_SORTS,
  type CatalogPet,
  type EventMap,
  type InstalledPet,
  type PetCatalogPage,
  type PetCatalogQuery,
  type PetManifest,
  type PetSource,
  type PetSpriteVersion,
} from '@aiwc/protocol'
import { t } from '../i18n'
import type { Logger } from '../log'
import { nullLogger } from '../log'
import { toMediaUrl } from '../security/pathAllowList'
import { inspectSpriteSheet, readImageSize, spriteVersionForSize } from './petAssets'
import { listZipEntries, readZipEntry, zipBaseName } from './zip'

type InstallStep = EventMap['pet:installStep']

export interface InstallOptions {
  signal?: AbortSignal
  onStep?: (step: InstallStep['step'], status: InstallStep['status'], detail?: string) => void
}

export interface PetServiceDeps {
  /** `<dataRoot>/pets` — one folder per pet id. */
  petsDir: string
  /** `resources/pets` shipped with the app; seeded into petsDir, never removable. */
  builtinDir: string
  logger?: Logger
  fetch?: typeof fetch
  /** Catalog origin; injectable for tests. */
  catalogBase?: string
  now?: () => number
  timeoutMs?: number
}

export interface PetService {
  /** Copy bundled pets that are missing or outdated into petsDir. Returns the bundled ids. */
  seedBuiltin(): Promise<string[]>
  listInstalled(): Promise<InstalledPet[]>
  get(id: string): Promise<InstalledPet | undefined>
  catalog(query: PetCatalogQuery): Promise<PetCatalogPage>
  /** 领养: download the package from the catalog, validate it and save it. */
  install(id: string, opts?: InstallOptions): Promise<InstalledPet>
  /** 导入: a zip downloaded from codex-pets.net (pet.json + spritesheet) or a hand-made package. */
  importZip(zipPath: string): Promise<InstalledPet>
  remove(id: string): Promise<void>
}

/** Sidecar next to pet.json recording where the pet came from (not part of the Codex Pets format). */
interface PetMeta {
  source: PetSource
  author?: string
  installedAt?: number
}

const SPRITE_FILES = ['spritesheet.webp', 'spritesheet.png'] as const
const IMAGE_EXT = /\.(webp|png)$/i
export const MAX_PACKAGE_BYTES = 32 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_PAGE_SIZE = 30
const MAX_PAGE_SIZE = 60
const TRUSTED_HOSTS = new Set(['codex-pets.net', 'www.codex-pets.net'])

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Any label → slug; falls back to a timestamp id so an import never lands on an empty name. */
export function slugifyPetId(value: string, now = Date.now()): string {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
  return isValidPetId(slug) ? slug : `pet-${now.toString(36)}`
}

/** https URL on codex-pets.net, else undefined (the catalog is untrusted input). */
export function trustedCatalogUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && TRUSTED_HOSTS.has(url.hostname) ? url.toString() : undefined
  } catch {
    return undefined
  }
}

export function parsePetManifest(raw: Buffer | string): PetManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'))
  } catch {
    throw new Error(t('main.pets.manifestInvalidJson'))
  }
  if (!isRecord(parsed)) throw new Error(t('main.pets.manifestNotObject'))
  const version = parsed.spriteVersionNumber
  if (version !== undefined && version !== 1 && version !== 2) throw new Error(t('main.pets.manifestBadVersion'))
  return {
    id: str(parsed.id),
    displayName: str(parsed.displayName),
    description: typeof parsed.description === 'string' ? parsed.description.trim() : undefined,
    spritesheetPath: str(parsed.spritesheetPath),
    spriteVersionNumber: version,
    kind: str(parsed.kind),
  }
}

/** Map one catalog record; undefined when it is malformed or points outside codex-pets.net. */
export function toCatalogPet(raw: unknown, installed: ReadonlySet<string>): CatalogPet | undefined {
  if (!isRecord(raw) || !isValidPetId(raw.id)) return undefined
  const spritesheetUrl = trustedCatalogUrl(raw.spritesheetUrl)
  const posterUrl = trustedCatalogUrl(raw.posterUrl)
  if (!spritesheetUrl || !posterUrl) return undefined
  const report = isRecord(raw.validationReport) ? raw.validationReport : {}
  const version: PetSpriteVersion =
    raw.spriteVersionNumber === 2 || report.spriteVersionNumber === 2 || report.atlasSize === '1536x2288' ? 2 : 1
  const uploadedAt = typeof raw.uploadedAt === 'string' ? Date.parse(raw.uploadedAt) : Number.NaN
  return {
    id: raw.id,
    displayName: str(raw.displayName) ?? raw.id,
    description: typeof raw.description === 'string' ? raw.description.trim() : '',
    author: str(raw.ownerName) ?? str(raw.ownerHandle),
    kind: str(raw.kind),
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string').slice(0, 8) : [],
    spriteVersion: version,
    posterUrl,
    previewUrl: trustedCatalogUrl(raw.previewUrl),
    spritesheetUrl,
    likeCount: num(raw.likeCount),
    downloadCount: num(raw.downloadCount),
    uploadedAt: Number.isFinite(uploadedAt) ? uploadedAt : undefined,
    installed: installed.has(raw.id),
  }
}

/** Sheet version from the file header (only the first bytes are read); the manifest is the fallback. */
async function sheetVersion(file: string, declared: unknown): Promise<PetSpriteVersion> {
  try {
    const fd = await open(file, 'r')
    try {
      const head = Buffer.alloc(64)
      const { bytesRead } = await fd.read(head, 0, head.length, 0)
      const size = readImageSize(head.subarray(0, bytesRead))
      const version = size ? spriteVersionForSize(size) : undefined
      if (version) return version
    } finally {
      await fd.close()
    }
  } catch {
    /* fall back to the manifest */
  }
  return declared === 2 ? 2 : 1
}

async function findSprite(dir: string): Promise<string | undefined> {
  for (const name of SPRITE_FILES) {
    try {
      if ((await stat(join(dir, name))).isFile()) return join(dir, name)
    } catch {
      /* try the next name */
    }
  }
  return undefined
}

async function readJson(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

const SOURCES: readonly PetSource[] = ['builtin', 'catalog', 'import']

export function createPetService(deps: PetServiceDeps): PetService {
  const log = (deps.logger ?? nullLogger).child('pets')
  const doFetch = deps.fetch ?? globalThis.fetch
  const base = (deps.catalogBase ?? PET_CATALOG_SITE).replace(/\/$/, '')
  const now = deps.now ?? (() => Date.now())
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let builtinIds: Set<string> | undefined

  const petDir = (id: string) => join(deps.petsDir, id)

  async function listBuiltinIds(): Promise<Set<string>> {
    if (builtinIds) return builtinIds
    const ids = new Set<string>()
    try {
      for (const entry of await readdir(deps.builtinDir, { withFileTypes: true })) {
        if (entry.isDirectory() && isValidPetId(entry.name) && (await findSprite(join(deps.builtinDir, entry.name))))
          ids.add(entry.name)
      }
    } catch {
      /* no bundled pets in this build */
    }
    builtinIds = ids
    return ids
  }

  async function readInstalled(id: string): Promise<InstalledPet | undefined> {
    const dir = petDir(id)
    const sprite = await findSprite(dir)
    if (!sprite) return undefined
    const manifest = await readJson(join(dir, 'pet.json'))
    const meta = await readJson(join(dir, 'meta.json'))
    const builtin = (await listBuiltinIds()).has(id)
    const source = SOURCES.find((s) => s === meta?.source) ?? 'import'
    return {
      id,
      displayName: str(manifest?.displayName) ?? id,
      description: typeof manifest?.description === 'string' ? manifest.description.trim() : '',
      builtin,
      source: builtin ? 'builtin' : source === 'builtin' ? 'import' : source,
      spriteVersion: await sheetVersion(sprite, manifest?.spriteVersionNumber),
      spriteUrl: toMediaUrl(sprite),
      author: str(meta?.author),
      installedAt: typeof meta?.installedAt === 'number' ? meta.installedAt : undefined,
    }
  }

  /** Assemble `<id>/` next to its final place and swap it in, so a crash never leaves half a pet. */
  async function writePet(
    id: string,
    manifest: PetManifest,
    sheet: Buffer,
    ext: 'webp' | 'png',
    version: PetSpriteVersion,
    meta: PetMeta,
  ): Promise<InstalledPet> {
    if ((await listBuiltinIds()).has(id)) throw new Error(t('main.pets.builtinOverwrite', { id }))
    await mkdir(deps.petsDir, { recursive: true })
    const staging = join(deps.petsDir, `.${id}.${now().toString(36)}.tmp`)
    await rm(staging, { recursive: true, force: true })
    await mkdir(staging, { recursive: true })
    try {
      const spritesheetPath = `spritesheet.${ext}`
      const persisted: PetManifest = {
        ...manifest,
        id,
        displayName: manifest.displayName ?? id,
        description: manifest.description ?? '',
        spritesheetPath,
        spriteVersionNumber: version,
      }
      await writeFile(join(staging, 'pet.json'), `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')
      await writeFile(join(staging, spritesheetPath), sheet)
      await writeFile(join(staging, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
      await rm(petDir(id), { recursive: true, force: true })
      await rename(staging, petDir(id))
    } catch (e) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined)
      throw e
    }
    const installed = await readInstalled(id)
    if (!installed) throw new Error(t('main.pets.readBackFailed'))
    return installed
  }

  /** pet.json + sheet from a zip (any folder depth), validated, not yet written. */
  function unpack(zip: Buffer, fallbackId: string) {
    const entries = listZipEntries(zip).filter((e) => !e.isDirectory && !e.name.startsWith('__MACOSX/'))
    if (entries.length === 0) throw new Error(t('main.pets.zipEmpty'))
    const manifestEntry = entries.find((e) => zipBaseName(e) === 'pet.json')
    if (!manifestEntry) throw new Error(t('main.pets.zipNoManifest'))
    const manifest = parsePetManifest(readZipEntry(zip, manifestEntry))
    const wanted = manifest.spritesheetPath ? basename(manifest.spritesheetPath) : undefined
    const images = entries.filter((e) => IMAGE_EXT.test(zipBaseName(e)))
    const sheetEntry =
      (wanted ? images.find((e) => zipBaseName(e) === wanted) : undefined) ??
      images.find((e) => /^(spritesheet|sprite)\.(webp|png)$/i.test(zipBaseName(e))) ??
      (images.length === 1 ? images[0] : undefined)
    if (!sheetEntry) throw new Error(t('main.pets.zipNoSheet'))
    const sheet = readZipEntry(zip, sheetEntry)
    if (sheet.length === 0) throw new Error(t('main.pets.sheetEmpty'))
    const { version, size } = inspectSpriteSheet(sheet, manifest.spriteVersionNumber)
    const ext: 'webp' | 'png' = size.format
    const id =
      manifest.id && isValidPetId(manifest.id)
        ? manifest.id
        : slugifyPetId(manifest.id ?? manifest.displayName ?? fallbackId, now())
    return { id, manifest, sheet, ext, version }
  }

  /** fetch with a timeout, an optional caller signal and a size cap. */
  async function request(url: string, accept: string, signal?: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    try {
      return await doFetch(url, { headers: { accept }, signal: combined })
    } catch (e) {
      if (signal?.aborted) throw new Error(t('main.pets.installCancelled'))
      if (timeout.aborted) throw new Error(t('main.pets.timeout'))
      throw new Error(t('main.pets.unreachable', { detail: errText(e) }))
    }
  }

  async function readBody(res: Response, signal?: AbortSignal): Promise<Buffer> {
    const declared = Number(res.headers.get('content-length') ?? 0)
    if (declared > MAX_PACKAGE_BYTES)
      throw new Error(t('main.pets.packageTooLarge', { mb: MAX_PACKAGE_BYTES / 1024 / 1024 }))
    try {
      const bytes = Buffer.from(await res.arrayBuffer())
      if (bytes.length > MAX_PACKAGE_BYTES)
        throw new Error(t('main.pets.packageTooLarge', { mb: MAX_PACKAGE_BYTES / 1024 / 1024 }))
      return bytes
    } catch (e) {
      if (signal?.aborted) throw new Error(t('main.pets.installCancelled'))
      throw e
    }
  }

  async function catalogJson(path: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const res = await request(`${base}${path}`, 'application/json', signal)
    if (!res.ok)
      throw new Error(res.status === 404 ? t('main.pets.notFound') : t('main.pets.httpError', { status: res.status }))
    let body: unknown
    try {
      body = await res.json()
    } catch {
      throw new Error(t('main.pets.badResponse'))
    }
    if (!isRecord(body)) throw new Error(t('main.pets.badResponse'))
    return body
  }

  const service: PetService = {
    async seedBuiltin() {
      const ids = [...(await listBuiltinIds())]
      for (const id of ids) {
        const src = join(deps.builtinDir, id)
        const sprite = await findSprite(src)
        if (!sprite) continue
        const dst = petDir(id)
        try {
          const current = await findSprite(dst)
          if (
            current &&
            basename(current) === basename(sprite) &&
            (await stat(current)).size === (await stat(sprite)).size
          )
            continue
          const staging = join(deps.petsDir, `.${id}.seed.tmp`)
          await mkdir(deps.petsDir, { recursive: true })
          await rm(staging, { recursive: true, force: true })
          await cp(src, staging, { recursive: true })
          const meta: PetMeta = { source: 'builtin', installedAt: now() }
          await writeFile(join(staging, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
          await rm(dst, { recursive: true, force: true })
          await rename(staging, dst)
          log.info('seeded bundled pet', { id })
        } catch (e) {
          log.warn('seeding bundled pet failed', { id, error: errText(e) })
        }
      }
      return ids
    },

    async listInstalled() {
      let names: string[]
      try {
        names = (await readdir(deps.petsDir, { withFileTypes: true }))
          .filter((e) => e.isDirectory() && isValidPetId(e.name))
          .map((e) => e.name)
      } catch {
        return []
      }
      const pets = (await Promise.all(names.map((id) => readInstalled(id)))).filter((p): p is InstalledPet =>
        Boolean(p),
      )
      return pets.sort(
        (a, b) =>
          Number(b.builtin) - Number(a.builtin) ||
          (b.installedAt ?? 0) - (a.installedAt ?? 0) ||
          a.id.localeCompare(b.id),
      )
    },

    async get(id) {
      return isValidPetId(id) ? readInstalled(id) : undefined
    },

    async catalog(query) {
      const page = Math.max(1, Math.floor(query.page ?? 1))
      const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(query.pageSize ?? DEFAULT_PAGE_SIZE)))
      const sort = query.sort && PET_CATALOG_SORTS.includes(query.sort) ? query.sort : 'new'
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (sort !== 'new') params.set('sort', sort)
      const q = query.query?.trim()
      if (q) params.set('q', q.slice(0, 80))
      const body = await catalogJson(`/api/pets?${params.toString()}`)
      const installed = new Set((await service.listInstalled()).map((p) => p.id))
      const pets = (Array.isArray(body.pets) ? body.pets : [])
        .map((p) => toCatalogPet(p, installed))
        .filter((p): p is CatalogPet => Boolean(p))
      const total = num(body.total)
      return {
        page: sort === 'random' ? 1 : num(body.page) || page,
        pageSize,
        total,
        totalPages: sort === 'random' ? 1 : Math.max(1, Math.ceil(total / pageSize)),
        pets,
      }
    },

    async install(id, opts = {}) {
      const { signal, onStep } = opts
      if (!isValidPetId(id)) throw new Error(t('main.pets.invalidId'))
      if ((await listBuiltinIds()).has(id)) throw new Error(t('main.pets.builtinAlreadyInstalled'))
      let step: InstallStep['step'] = 'download'
      try {
        onStep?.('download', 'doing')
        // Author for the 我的宠物 card; the package itself is what gets validated and saved.
        const info = await catalogJson(`/api/pets/${encodeURIComponent(id)}`, signal)
        const record = isRecord(info.pet) ? info.pet : undefined
        const author = str(record?.ownerName) ?? str(record?.ownerHandle)
        const res = await request(`${base}/api/pets/${encodeURIComponent(id)}/download`, 'application/zip', signal)
        if (!res.ok) throw new Error(t('main.pets.downloadFailed', { status: res.status }))
        const zip = await readBody(res, signal)
        onStep?.('download', 'done', `${(zip.length / 1024 / 1024).toFixed(1)} MB`)

        step = 'verify'
        onStep?.('verify', 'doing')
        const pkg = unpack(zip, id)
        if (pkg.id !== id) pkg.id = id
        onStep?.('verify', 'done', t('main.pets.verified', { version: pkg.version }))
        if (signal?.aborted) throw new Error(t('main.pets.installCancelled'))

        step = 'save'
        onStep?.('save', 'doing')
        const installed = await writePet(id, pkg.manifest, pkg.sheet, pkg.ext, pkg.version, {
          source: 'catalog',
          author,
          installedAt: now(),
        })
        onStep?.('save', 'done')
        log.info('pet installed from catalog', { id })
        return installed
      } catch (e) {
        onStep?.(step, 'failed', errText(e))
        throw e
      }
    },

    async importZip(zipPath) {
      const info = await stat(zipPath)
      if (!info.isFile()) throw new Error(t('main.pets.importNotFile'))
      if (info.size > MAX_PACKAGE_BYTES)
        throw new Error(t('main.pets.packageTooLarge', { mb: MAX_PACKAGE_BYTES / 1024 / 1024 }))
      const pkg = unpack(await readFile(zipPath), basename(zipPath, extname(zipPath)))
      const installed = await writePet(pkg.id, pkg.manifest, pkg.sheet, pkg.ext, pkg.version, {
        source: 'import',
        installedAt: now(),
      })
      log.info('pet imported', { id: pkg.id })
      return installed
    },

    async remove(id) {
      if (!isValidPetId(id)) throw new Error(t('main.pets.invalidId'))
      if ((await listBuiltinIds()).has(id)) throw new Error(t('main.pets.builtinNoDelete'))
      await rm(petDir(id), { recursive: true, force: true })
      log.info('pet removed', { id })
    },
  }
  return service
}
