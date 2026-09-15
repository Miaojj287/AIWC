import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { t } from '../i18n'
import { createPetService, slugifyPetId, toCatalogPet, trustedCatalogUrl } from './petService'
import { buildZip } from './zipTestUtil'

/** A WebP (VP8X) header that claims the given canvas size, padded like a real file. */
function sheet(width = 1536, height = 1872): Buffer {
  const b = Buffer.alloc(256)
  b.write('RIFF', 0, 'latin1')
  b.writeUInt32LE(248, 4)
  b.write('WEBP', 8, 'latin1')
  b.write('VP8X', 12, 'latin1')
  b.writeUIntLE(width - 1, 24, 3)
  b.writeUIntLE(height - 1, 27, 3)
  return b
}

let root: string
let petsDir: string
let builtinDir: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aiwc-pets-'))
  petsDir = join(root, 'data', 'pets')
  builtinDir = join(root, 'resources', 'pets')
  mkdirSync(join(builtinDir, 'aiwcji'), { recursive: true })
  writeFileSync(
    join(builtinDir, 'aiwcji', 'pet.json'),
    JSON.stringify({ id: 'aiwcji', displayName: 'AIWC 鸡', description: '内置' }),
  )
  writeFileSync(join(builtinDir, 'aiwcji', 'spritesheet.webp'), sheet())
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const service = (extra: Partial<Parameters<typeof createPetService>[0]> = {}) =>
  createPetService({ petsDir, builtinDir, now: () => 1_000, ...extra })

describe('bundled pets', () => {
  it('seeds into the pets folder once and lists them first with a media URL and the header version', async () => {
    const pets = service()
    expect(await pets.seedBuiltin()).toEqual(['aiwcji'])
    expect(await pets.seedBuiltin()).toEqual(['aiwcji'])
    const [pet] = await pets.listInstalled()
    expect(pet).toMatchObject({
      id: 'aiwcji',
      displayName: 'AIWC 鸡',
      builtin: true,
      source: 'builtin',
      spriteVersion: 1,
    })
    expect(pet!.spriteUrl).toMatch(/^aiwc-media:\/\/.*\/pets\/aiwcji\/spritesheet\.webp$/)
    await expect(pets.remove('aiwcji')).rejects.toThrow('内置宠物不能删除')
    expect(readdirSync(petsDir).filter((n) => n.startsWith('.'))).toEqual([])
  })

  it('re-seeds a bundled pet whose sheet changed', async () => {
    await service().seedBuiltin()
    writeFileSync(join(builtinDir, 'aiwcji', 'spritesheet.webp'), Buffer.concat([sheet(), Buffer.alloc(10)]))
    await service().seedBuiltin()
    expect(readFileSync(join(petsDir, 'aiwcji', 'spritesheet.webp')).length).toBe(266)
  })
})

describe('importZip', () => {
  const writeZip = (name: string, files: Parameters<typeof buildZip>[0]) => {
    const file = join(root, name)
    writeFileSync(file, buildZip(files))
    return file
  }

  it('installs a codex-pets.net download (nested folder, deflated sheet, v2 atlas)', async () => {
    const pets = service()
    const zip = writeZip('nessie.zip', [
      {
        name: 'apex-nessie/pet.json',
        data: JSON.stringify({ id: 'apex-nessie', displayName: 'Apex Nessie', spriteVersionNumber: 2 }),
      },
      { name: 'apex-nessie/spritesheet.webp', data: sheet(1536, 2288), deflate: true },
    ])
    const pet = await pets.importZip(zip)
    expect(pet).toMatchObject({
      id: 'apex-nessie',
      displayName: 'Apex Nessie',
      source: 'import',
      spriteVersion: 2,
      builtin: false,
    })
    const manifest = JSON.parse(readFileSync(join(petsDir, 'apex-nessie', 'pet.json'), 'utf8'))
    expect(manifest).toMatchObject({ id: 'apex-nessie', spritesheetPath: 'spritesheet.webp', spriteVersionNumber: 2 })
    await pets.remove('apex-nessie')
    expect(existsSync(join(petsDir, 'apex-nessie'))).toBe(false)
  })

  it('derives an id from the display name when pet.json has none and accepts PNG sheets', async () => {
    const png = Buffer.alloc(64)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png)
    png.write('IHDR', 12, 'latin1')
    png.writeUInt32BE(1536, 16)
    png.writeUInt32BE(1872, 20)
    const pet = await service().importZip(
      writeZip('x.zip', [
        { name: 'pet.json', data: '{"displayName":"Fire Ball!"}' },
        { name: 'sprite.png', data: png },
      ]),
    )
    expect(pet.id).toBe('fire-ball')
    expect(existsSync(join(petsDir, 'fire-ball', 'spritesheet.png'))).toBe(true)
  })

  it('explains broken packages and writes nothing', async () => {
    const pets = service()
    await expect(pets.importZip(writeZip('a.zip', [{ name: 'spritesheet.webp', data: sheet() }]))).rejects.toThrow(
      '找不到 pet.json',
    )
    await expect(pets.importZip(writeZip('b.zip', [{ name: 'pet.json', data: '{"id":"b"}' }]))).rejects.toThrow(
      '找不到精灵图',
    )
    await expect(
      pets.importZip(
        writeZip('c.zip', [
          { name: 'pet.json', data: '{"id":"c"}' },
          { name: 'spritesheet.webp', data: sheet(512, 512) },
        ]),
      ),
    ).rejects.toThrow('当前 512×512')
    await expect(
      pets.importZip(
        writeZip('d.zip', [
          { name: 'pet.json', data: 'nope' },
          { name: 'spritesheet.webp', data: sheet() },
        ]),
      ),
    ).rejects.toThrow('不是合法的 JSON')
    await expect(
      pets.importZip(
        writeZip('e.zip', [
          { name: 'pet.json', data: '{"id":"aiwcji"}' },
          { name: 'spritesheet.webp', data: sheet() },
        ]),
      ),
    ).rejects.toThrow('内置宠物')
    expect(existsSync(petsDir) ? readdirSync(petsDir) : []).toEqual([])
  })
})

type FakeRoute = (url: URL, init?: RequestInit) => Response | Promise<Response>

function fakeFetch(route: FakeRoute): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    return route(new URL(String(input)), init)
  }) as typeof fetch
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const catalogRecord = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  displayName: id.toUpperCase(),
  description: 'desc',
  ownerName: 'someone',
  tags: ['cute', 3],
  spritesheetUrl: `https://codex-pets.net/assets/pets/v/1/${id}/spritesheet.webp`,
  posterUrl: `https://codex-pets.net/assets/pets/v/1/${id}/poster.webp`,
  previewUrl: `https://codex-pets.net/assets/pets/v/1/${id}/preview.webp`,
  likeCount: 5,
  uploadedAt: '2026-09-12T09:01:03.260Z',
  validationReport: { atlasSize: '1536x2288' },
  ...extra,
})

describe('catalog', () => {
  it('maps records, drops untrusted asset URLs, marks installed pets and forwards search / sort', async () => {
    const seen: URL[] = []
    const pets = service({
      fetch: fakeFetch((url) => {
        seen.push(url)
        return json({
          page: 2,
          pageSize: 30,
          total: 61,
          pets: [
            catalogRecord('aiwcji'),
            catalogRecord('evil', { posterUrl: 'http://attacker.example/p.webp' }),
            catalogRecord('dewey'),
            { id: 'Bad Id' },
          ],
        })
      }),
    })
    await pets.seedBuiltin()
    const page = await pets.catalog({ page: 2, sort: 'popular', query: ' 猫 ' })
    expect(seen[0]!.pathname).toBe('/api/pets')
    expect(Object.fromEntries(seen[0]!.searchParams)).toEqual({ page: '2', pageSize: '30', sort: 'popular', q: '猫' })
    expect(page.pets.map((p) => [p.id, p.installed])).toEqual([
      ['aiwcji', true],
      ['dewey', false],
    ])
    expect(page).toMatchObject({ page: 2, total: 61, totalPages: 3 })
    expect(page.pets[1]).toMatchObject({ author: 'someone', tags: ['cute'], spriteVersion: 2, likeCount: 5 })
  })

  it('surfaces HTTP and network failures as messages', async () => {
    await expect(service({ fetch: fakeFetch(() => json({ error: 'x' }, 500)) }).catalog({})).rejects.toThrow('HTTP 500')
    await expect(
      service({ fetch: fakeFetch(() => Promise.reject(new TypeError('fetch failed'))) }).catalog({}),
    ).rejects.toThrow('无法连接 codex-pets.net')
  })

  it('only trusts https URLs on codex-pets.net', () => {
    expect(trustedCatalogUrl('https://codex-pets.net/a.webp')).toBe('https://codex-pets.net/a.webp')
    expect(trustedCatalogUrl('http://codex-pets.net/a.webp')).toBeUndefined()
    expect(trustedCatalogUrl('https://codex-pets.net.evil.io/a.webp')).toBeUndefined()
    expect(
      toCatalogPet(
        { id: 'x', spritesheetUrl: 'https://codex-pets.net/s', posterUrl: 'javascript:alert(1)' },
        new Set(),
      ),
    ).toBeUndefined()
  })
})

describe('install', () => {
  const pkg = (id: string, sheetBuf = sheet(1536, 2288)) =>
    buildZip([
      { name: 'pet.json', data: JSON.stringify({ id, displayName: 'Dewey', spriteVersionNumber: 2 }) },
      { name: 'spritesheet.webp', data: sheetBuf, deflate: true },
    ])

  it('downloads, verifies and saves with step reports and the author', async () => {
    const steps: string[] = []
    const pets = service({
      fetch: fakeFetch((url) => {
        if (url.pathname === '/api/pets/dewey') return json({ pet: catalogRecord('dewey') })
        if (url.pathname === '/api/pets/dewey/download')
          return new Response(pkg('dewey'), { headers: { 'content-type': 'application/zip' } })
        return json({}, 404)
      }),
    })
    const pet = await pets.install('dewey', { onStep: (step, status) => steps.push(`${step}:${status}`) })
    expect(pet).toMatchObject({ id: 'dewey', source: 'catalog', author: 'someone', spriteVersion: 2 })
    expect(steps).toEqual(['download:doing', 'download:done', 'verify:doing', 'verify:done', 'save:doing', 'save:done'])
    expect((await pets.listInstalled()).map((p) => p.id)).toEqual(['dewey'])
  })

  it('reports the failing step and leaves nothing behind', async () => {
    const steps: string[] = []
    const pets = service({
      fetch: fakeFetch((url) =>
        url.pathname.endsWith('/download')
          ? new Response(pkg('dewey', sheet(100, 100)))
          : json({ pet: catalogRecord('dewey') }),
      ),
    })
    await expect(pets.install('dewey', { onStep: (step, status) => steps.push(`${step}:${status}`) })).rejects.toThrow(
      '当前 100×100',
    )
    expect(steps.at(-1)).toBe('verify:failed')
    expect(await pets.listInstalled()).toEqual([])
  })

  it('stops when cancelled, refuses bundled ids and bad ids, and reports a missing pet', async () => {
    const controller = new AbortController()
    controller.abort()
    const pets = service({ fetch: fakeFetch(() => json({}, 404)) })
    await expect(pets.install('dewey', { signal: controller.signal })).rejects.toThrow(t('main.pets.installCancelled'))
    await pets.seedBuiltin()
    await expect(pets.install('aiwcji')).rejects.toThrow('内置宠物')
    await expect(pets.install('../etc')).rejects.toThrow('无效的宠物 id')
    await expect(pets.install('ghost')).rejects.toThrow('找不到这只宠物')
  })
})

describe('slugifyPetId', () => {
  it('keeps latin names readable and falls back for non-latin ones', () => {
    expect(slugifyPetId('Café  Crème--Brûlée')).toBe('cafe-creme-brulee')
    expect(slugifyPetId('猫猫虫', 36)).toBe('pet-10')
  })
})
