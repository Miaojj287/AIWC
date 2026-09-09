/**
 * Small shared helpers for the tooling half: zod → JSON Schema, compact input rendering,
 * character-bounded output truncation and JSON coercion. Token-bounded truncation and context
 * fragments come from @aiwc/protocol (`truncateToTokens` / `createFragment`) — not duplicated here.
 */
import { z } from 'zod'
import type { JsonValue } from '@aiwc/protocol'

const FALLBACK_SCHEMA: Record<string, unknown> = { type: 'object', properties: {}, additionalProperties: true }

/** JSON Schema (input side) for a tool's zod schema. Never throws: unrepresentable → `{}`. */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  try {
    const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any', target: 'draft-2020-12' }) as Record<string, unknown>
    delete json.$schema
    if (json.type === undefined && json.properties !== undefined) json.type = 'object'
    return json
  } catch {
    return { ...FALLBACK_SCHEMA }
  }
}

/** One-line, whitespace-collapsed JSON rendering of a tool input, bounded to `max` chars. */
export function compactInput(input: unknown, max = 120): string {
  let text: string
  try {
    text = input === undefined ? '' : JSON.stringify(input) ?? String(input)
  } catch {
    text = String(input)
  }
  text = text.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** JSON round-trip so arbitrary values fit the JsonValue wire type (functions / undefined → null). */
export function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null
  try {
    const out: unknown = JSON.parse(JSON.stringify(value))
    return (out ?? null) as JsonValue
  } catch {
    return String(value)
  }
}

export interface TruncatedText {
  text: string
  truncated: boolean
}

/** Same shape as the marker @aiwc/protocol's truncateToTokens appends, so model and UI see one format. */
export const TRUNCATION_MARKER = (total: number, kept: number): string => `\n[…已截断 ${total - kept} 字]`

/** Cut `text` at `maxChars`, appending a marker so both the model and the UI know something is missing. */
export function truncateText(text: string, maxChars: number): TruncatedText {
  if (maxChars <= 0 || text.length <= maxChars) return { text, truncated: false }
  return { text: text.slice(0, maxChars) + TRUNCATION_MARKER(text.length, maxChars), truncated: true }
}
