/**
 * AI 宠物 (Codex Pets) contract: sprite-sheet geometry, the installed-pet record the renderer draws
 * from, and the community catalog (codex-pets.net) the settings page browses.
 *
 * Sprite sheets follow the Codex Pets convention: 8 columns × 192×208 frames, one animation state per
 * row. v1 sheets have 9 rows (1536×1872); v2 sheets add two "look around" rows (1536×2288).
 */

export const PET_FRAME_WIDTH = 192
export const PET_FRAME_HEIGHT = 208
export const PET_SHEET_COLUMNS = 8

export type PetSpriteVersion = 1 | 2

export const PET_SHEET_ROWS: Record<PetSpriteVersion, number> = { 1: 9, 2: 11 }

export const PET_SHEET_WIDTH = PET_FRAME_WIDTH * PET_SHEET_COLUMNS

/** Exact sheet height per version — anything else is not a pet sheet. */
export const PET_SHEET_HEIGHT: Record<PetSpriteVersion, number> = {
  1: PET_FRAME_HEIGHT * PET_SHEET_ROWS[1],
  2: PET_FRAME_HEIGHT * PET_SHEET_ROWS[2],
}

/** `pet.json` inside a pet folder / zip (the codex-pets.net manifest shape). */
export interface PetManifest {
  id?: string
  displayName?: string
  description?: string
  /** Relative to the manifest, default `spritesheet.webp`. */
  spritesheetPath?: string
  /** 2 for 1536×2288 sheets; absent / 1 for the legacy 1536×1872 sheet. */
  spriteVersionNumber?: number
  kind?: string
}

export type PetSource = 'builtin' | 'catalog' | 'import'

/** A pet on disk (`<dataRoot>/pets/<id>/`), ready to render. */
export interface InstalledPet {
  id: string
  displayName: string
  description: string
  /** Shipped with the app: cannot be removed, re-seeded when missing. */
  builtin: boolean
  source: PetSource
  spriteVersion: PetSpriteVersion
  /** `aiwc-media://` URL of the sprite sheet (served through the path allow-list). */
  spriteUrl: string
  /** Community author (catalog installs). */
  author?: string
  installedAt?: number
}

export type PetCatalogSort = 'new' | 'popular' | 'views' | 'discussed' | 'random'

export const PET_CATALOG_SORTS: readonly PetCatalogSort[] = ['new', 'popular', 'views', 'discussed', 'random']

export const PET_CATALOG_SITE = 'https://codex-pets.net'

/** The pet's page on codex-pets.net (hash route). */
export const petPageUrl = (id: string): string => `${PET_CATALOG_SITE}/#/pets/${encodeURIComponent(id)}`

/** One card of the community gallery. */
export interface CatalogPet {
  id: string
  displayName: string
  description: string
  author?: string
  kind?: string
  tags: string[]
  spriteVersion: PetSpriteVersion
  /** Single idle frame (192×208), for cards. */
  posterUrl: string
  /** Every animation frame at half scale in one horizontal strip (96×104 per frame), for hover previews. */
  previewUrl?: string
  spritesheetUrl: string
  likeCount: number
  downloadCount: number
  uploadedAt?: number
  /** Already in `<dataRoot>/pets` (the card offers 选用 instead of 领养). */
  installed: boolean
}

export interface PetCatalogQuery {
  page?: number
  pageSize?: number
  sort?: PetCatalogSort
  /** Free-text search (name / description). */
  query?: string
}

export interface PetCatalogPage {
  page: number
  pageSize: number
  total: number
  totalPages: number
  pets: CatalogPet[]
}

/** Slug rule shared by the catalog, the importer and the config (`pet.current`). */
export const PET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

export const isValidPetId = (id: unknown): id is string => typeof id === 'string' && PET_ID_PATTERN.test(id)
