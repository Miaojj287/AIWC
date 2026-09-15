import { describe, expect, it } from 'vitest'
import { sampleProfile } from '../testing/fakes'
import { applyCorrections, profileEditCorrections } from './corrections'

/** The legacy clone:updateProfile row cut its JSON at 2000 characters. */
const LEGACY_CAP = 2000

describe('profile edit corrections', () => {
  it('records only the edited keys, untruncated, so a large edit survives a re-clone', () => {
    const before = sampleProfile()
    const facts = Array.from({ length: 40 }, (_, i) => `事实 ${i}：${'一段很长的细节描述'.repeat(10)}`)
    expect(JSON.stringify({ facts }).length).toBeGreaterThan(LEGACY_CAP)
    const rows = profileEditCorrections(
      before,
      { card: before.card, deep: { ...before.deep, facts }, samples: before.samples },
      1_000,
    )
    expect(rows).toHaveLength(1)
    const [row] = rows
    expect(row).toMatchObject({ at: 1_000, field: 'deep' })
    expect(JSON.parse(row?.to ?? '')).toEqual({ facts })
    expect(JSON.parse(row?.from ?? '')).toEqual({ facts: before.deep.facts })

    // the rebuilt profile keeps what the model found for the keys the user did not touch
    const rebuilt = sampleProfile({
      deep: { ...before.deep, facts: ['模型重新提炼的事实'], relationship: '重新提炼的关系' },
    })
    const applied = applyCorrections(rebuilt.card, rebuilt.deep, rows)
    expect(applied.deep.facts).toEqual(facts)
    expect(applied.deep.relationship).toBe('重新提炼的关系')
    expect(applied.skipped).toEqual([])
  })

  it('records nothing for a save that changed nothing, and only the samples that changed', () => {
    const before = sampleProfile()
    expect(
      profileEditCorrections(before, { card: { ...before.card }, deep: before.deep, samples: [...before.samples] }, 5),
    ).toEqual([])
    const [first, second] = before.samples
    if (!first || !second) throw new Error('fixture needs two samples')
    const edited = { ...second, reply: '改过的回复', corrected: true }
    expect(profileEditCorrections(before, { samples: [first, edited] }, 5)).toEqual([
      { at: 5, field: 'samples', from: JSON.stringify([second]), to: JSON.stringify([edited]) },
    ])
    const catchphrases = [...before.card.catchphrases, '好家伙']
    expect(profileEditCorrections(before, { card: { ...before.card, catchphrases } }, 6)).toEqual([
      {
        at: 6,
        field: 'card',
        from: JSON.stringify({ catchphrases: before.card.catchphrases }),
        to: JSON.stringify({ catchphrases }),
      },
    ])
  })

  it('reports the corrections it could not apply instead of dropping them silently', () => {
    const { card, deep } = sampleProfile()
    const r = applyCorrections(card, deep, [
      { at: 1, field: 'deep', from: '{}', to: JSON.stringify({ facts: ['截断'.repeat(1_200)] }).slice(0, LEGACY_CAP) },
      { at: 2, field: 'card', from: '{}', to: JSON.stringify({ tone: '不是数组' }) },
      { at: 3, field: 'card.addressing.other.x', from: '', to: 'y' },
      { at: 4, field: 'card.addressing', from: '', to: 'y' },
      // not profile corrections: never applied here, never reported
      { at: 5, field: 'feedback:itm_1', from: 'down', to: '太客气了' },
      { at: 6, field: 'samples', from: '[]', to: '[]' },
      // already satisfied: a no-op, not a failure
      { at: 7, field: 'card.catchphrases', from: '', to: '哈哈哈' },
    ])
    expect(r.applied).toBe(0)
    expect(r.skipped).toEqual([
      { at: 1, field: 'deep', reason: 'unparseable' },
      { at: 2, field: 'card', reason: 'no_applicable_keys' },
      { at: 3, field: 'card.addressing.other.x', reason: 'bad_path' },
      { at: 4, field: 'card.addressing', reason: 'type_mismatch' },
    ])
  })
})
