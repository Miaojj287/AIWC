/**
 * Redaction for the model call log: API keys, bearer tokens and the provider's own key never reach usage.db, even
 * when 记录内容 is on (AGENTS.md §2.4 / §6). Applied to recorded content and to error messages.
 */
import { SECRET_FIELD_PATTERNS } from '../services/redact'

const REDACTED = '[REDACTED]'

const SECRET_PATTERNS: readonly RegExp[] = [
  // OpenAI / DeepSeek / Moonshot / Anthropic style keys (sk-…, sk-ant-…, rk-…)
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}/g,
  // Google API keys
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  // Authorization headers and bearer tokens
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  // "api_key": "…", x-api-key=…, authorization / token / password / cookie / secret: … — the same field list the
  // diagnostics redactor uses, so a credential field masked in one place is masked in the other.
  ...SECRET_FIELD_PATTERNS,
]

/** Mask `knownSecrets` (exact values, e.g. the provider's key) and anything shaped like a credential. */
export function redactSecrets(text: string, knownSecrets: readonly (string | undefined)[] = []): string {
  let out = text
  for (const secret of knownSecrets) if (secret && secret.length >= 6) out = out.split(secret).join(REDACTED)
  for (const pattern of SECRET_PATTERNS)
    out = out.replace(pattern, (match, prefix?: unknown) =>
      typeof prefix === 'string' && match.startsWith(prefix) ? `${prefix}${REDACTED}` : REDACTED,
    )
  return out
}
