/**
 * Reads one XML part out of an Office (OOXML) package with the shared ZIP reader. Errors from the ZIP
 * layer speak about pet packages, so they are replaced by one message about the document itself.
 */
import { listZipEntries, readZipEntry, type ZipEntry } from '../zip'
import { t } from '../../i18n'

/** Largest single part a preview inflates (sheet XML, document.xml, shared strings). */
export const MAX_PREVIEW_PART_BYTES = 24 * 1024 * 1024
/** Most bytes one preview inflates across all its parts. */
export const MAX_PREVIEW_TOTAL_BYTES = 48 * 1024 * 1024

/**
 * Per file (one preview reads the file into its own buffer): the entry list, the parts already read (a part named
 * twice — two sheets pointing at one target — is inflated once) and the bytes inflated so far.
 */
interface PreviewState {
  entries: ZipEntry[]
  parts: Map<string, string>
  inflated: number
}
const states = new WeakMap<Buffer, PreviewState>()

export const unreadableOfficeFile = (): Error => new Error(t('main.data.previewUnreadable'))
export const officeFileTooLarge = (): Error => new Error(t('main.data.previewTooLarge'))

function stateOf(file: Buffer): PreviewState {
  const cached = states.get(file)
  if (cached) return cached
  let entries: ZipEntry[]
  try {
    entries = listZipEntries(file)
  } catch (e) {
    throw new Error(unreadableOfficeFile().message, { cause: e })
  }
  const state: PreviewState = { entries, parts: new Map(), inflated: 0 }
  states.set(file, state)
  return state
}

/**
 * The UTF-8 text of part `name` (case-insensitive, without a leading slash); undefined when absent. A small file
 * can declare huge parts (a zip bomb): the declared size is checked against the per-part and per-preview caps
 * before anything is inflated, and inflation never exceeds the declared size (zip.ts).
 */
export function readOfficePart(file: Buffer, name: string, required: true): string
export function readOfficePart(file: Buffer, name: string, required?: false): string | undefined
export function readOfficePart(file: Buffer, name: string, required = false): string | undefined {
  const wanted = name.replace(/^\//, '').toLowerCase()
  const state = stateOf(file)
  const seen = state.parts.get(wanted)
  if (seen !== undefined) return seen
  const entry = state.entries.find((e) => e.name.toLowerCase() === wanted)
  if (!entry) {
    if (required) throw unreadableOfficeFile()
    return undefined
  }
  if (entry.size > MAX_PREVIEW_PART_BYTES || state.inflated + entry.size > MAX_PREVIEW_TOTAL_BYTES)
    throw officeFileTooLarge()
  let text: string
  try {
    text = readZipEntry(file, entry).toString('utf8')
  } catch (e) {
    throw new Error(unreadableOfficeFile().message, { cause: e })
  }
  state.inflated += entry.size
  state.parts.set(wanted, text)
  return text
}
