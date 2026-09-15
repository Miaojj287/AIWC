/**
 * Persistent app configuration (zod-validated). Secrets are NOT stored here: fields ending in
 * `Ref` point into the OS-backed secret store (electron safeStorage).
 */
import { z } from 'zod'
import { PET_ID_PATTERN } from './pet'

export const ThemeSchema = z.enum(['dark', 'light', 'system'])
const AppearancePaletteSchema = z.object({
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  surface: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  foreground: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  contrast: z.number().int().min(0).max(100),
})

/** 透明效果 is on for new installs and after 恢复默认外观; a value the user already saved is kept. */
export const DEFAULT_TRANSPARENCY = true

export const DEFAULT_APPEARANCE = {
  light: { accent: '#4e82ef', background: '#ffffff', surface: '#e9e9e9', foreground: '#000000', contrast: 35 },
  dark: { accent: '#4e82ef', background: '#181818', surface: '#393939', foreground: '#ffffff', contrast: 81 },
} as const

const LEGACY_APPEARANCE = {
  light: { accent: '#c45100', background: '#f7f8fa', foreground: '#1a1b22', contrast: 35 },
  dark: { accent: '#ff7a1f', background: '#15161c', foreground: '#e8e9ee', contrast: 35 },
} as const

const samePalette = (
  left: unknown,
  right: { accent: string; background: string; foreground: string; contrast: number },
): boolean => {
  if (!left || typeof left !== 'object') return false
  const value = left as Record<string, unknown>
  return (
    value.surface === undefined &&
    value.accent === right.accent &&
    value.background === right.background &&
    value.foreground === right.foreground &&
    value.contrast === right.contrast
  )
}

const mixHex = (a: string, b: string, amount: number): string => {
  const rgb = [1, 3, 5].map((i) =>
    Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - amount) + parseInt(b.slice(i, i + 2), 16) * amount),
  )
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** Before surface was configurable it was derived from background, font color and contrast. */
const addLegacySurface = (raw: unknown): unknown => {
  if (!raw || typeof raw !== 'object') return raw
  const value = raw as Record<string, unknown>
  if (value.surface !== undefined) return value
  if (
    typeof value.background !== 'string' ||
    typeof value.foreground !== 'string' ||
    typeof value.contrast !== 'number'
  )
    return value
  return { ...value, surface: mixHex(value.background, value.foreground, 0.04 + (value.contrast / 100) * 0.127) }
}

/** Upgrade untouched legacy defaults while preserving every palette the user customized. */
const AppearanceSchema = z.preprocess(
  (raw) => {
    if (!raw || typeof raw !== 'object') return raw
    const value = raw as Record<string, unknown>
    return {
      ...value,
      light: samePalette(value.light, LEGACY_APPEARANCE.light)
        ? DEFAULT_APPEARANCE.light
        : addLegacySurface(value.light),
      dark: samePalette(value.dark, LEGACY_APPEARANCE.dark) ? DEFAULT_APPEARANCE.dark : addLegacySurface(value.dark),
    }
  },
  z.object({
    light: AppearancePaletteSchema.default(DEFAULT_APPEARANCE.light),
    dark: AppearancePaletteSchema.default(DEFAULT_APPEARANCE.dark),
  }),
)

export const CloseBehaviorSchema = z.enum(['quit', 'minimize', 'ask'])

/** Window layout: the four-column workbench, or the Agent window (CLAUDE.md §12). */
export const ShellModeSchema = z.enum(['workbench', 'agent'])

/**
 * UI language (设置 › 常规 › 语言). Every user-facing string in src/ and electron/ resolves through
 * `@aiwc/i18n` with one catalog per entry here — adding a language means adding a catalog, never a
 * second copy of the UI (CLAUDE.md §11).
 */
export const LanguageSchema = z.enum(['zh-CN', 'en-US'])
export type Language = z.infer<typeof LanguageSchema>
export const LANGUAGES = LanguageSchema.options
export const DEFAULT_LANGUAGE: Language = 'zh-CN'
export const PermissionModeSchema = z.enum(['ask', 'bypass', 'autopilot'])

/** Per-model reasoning depth (设置 › AI 接入 › 推理强度). `off` = no thinking; mapped per provider in the kernel. */
export const ReasoningEffortSchema = z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

export const ModelCapabilitiesSchema = z.object({
  reasoning: z.array(ReasoningEffortSchema).default([]),
  thinking: z.enum(['none', 'effort', 'adaptive', 'budget']).default('none'),
  thinkingBudgetMin: z.number().int().nonnegative().optional(),
  thinkingBudgetMax: z.number().int().positive().optional(),
  fast: z.boolean().default(false),
  temperature: z.boolean().default(false),
  contextLimit: z.number().int().positive().optional(),
  outputLimit: z.number().int().positive().optional(),
  source: z.enum(['api', 'profile', 'unknown']).default('unknown'),
})
export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>

export const ModelEntrySchema = z.object({
  modelId: z.string().min(1),
  label: z.string().min(1),
  /** One-line note shown under the model name (from the vendor preset or the user). */
  description: z.string().optional(),
  contextWindow: z.number().int().positive().default(128_000),
  maxOutputTokens: z.number().int().positive().optional(),
  supportsTools: z.boolean().default(true),
  supportsVision: z.boolean().default(false),
  /** Disabled models stay configured but are hidden from the model pickers. */
  enabled: z.boolean().default(true),
  reasoningEffort: ReasoningEffortSchema.optional(),
  thinkingBudget: z.number().int().nonnegative().optional(),
  temperature: z.number().min(0).max(2).optional(),
  capabilities: ModelCapabilitiesSchema.optional(),
  source: z.enum(['remote', 'manual']).optional(),
  available: z.boolean().optional(),
  /** 快速模式：provider fast / priority service tier where supported. */
  fast: z.boolean().optional(),
})

export const ProviderTestSchema = z.object({
  ok: z.boolean(),
  at: z.number(),
  latencyMs: z.number().optional(),
  message: z.string().optional(),
})

export const ProviderSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['openai', 'anthropic', 'google', 'openai-compatible', 'ollama']),
  label: z.string().min(1),
  /** Vendor preset id (deepseek / kimi / glm …); absent for hand-configured providers. */
  vendor: z.string().optional(),
  baseUrl: z.string().optional(),
  apiKeyRef: z.string().optional(),
  models: z.array(ModelEntrySchema).default([]),
  /** Result of the last 测试连接, drives the status dot in the provider list. */
  lastTest: ProviderTestSchema.optional(),
  modelsSyncedAt: z.number().optional(),
  ignoredModelIds: z.array(z.string()).optional(),
})

export const ModelSelectionSchema = z.object({ providerId: z.string(), modelId: z.string() })

export const SttConfigSchema = z.object({
  mode: z.enum(['local', 'online']).default('local'),
  localModelId: z.string().optional(),
  online: ProviderSchema.optional(),
})

export const AppConfigSchema = z.object({
  version: z.literal(1).default(1),
  general: z
    .object({
      theme: ThemeSchema.default('dark'),
      appearance: AppearanceSchema.prefault({}),
      /** 透明效果: the rail + object list show the desktop through native vibrancy (macOS) / acrylic (Windows 11). */
      transparency: z.boolean().default(DEFAULT_TRANSPARENCY),
      launchAtLogin: z.boolean().default(false),
      closeBehavior: CloseBehaviorSchema.default('ask'),
      // An unknown value written by a newer build falls back instead of discarding the whole config.
      language: LanguageSchema.catch(DEFAULT_LANGUAGE).default(DEFAULT_LANGUAGE),
    })
    .prefault({}),
  account: z
    .object({
      wxid: z.string().optional(),
      dbRoot: z.string().optional(),
      cacheDir: z.string().optional(),
      dbKeyRef: z.string().optional(),
      imageXorKeyRef: z.string().optional(),
      imageAesKeyRef: z.string().optional(),
      verifiedAt: z.number().optional(),
    })
    .prefault({}),
  ai: z
    .object({
      providers: z.array(ProviderSchema).default([]),
      defaultModel: ModelSelectionSchema.optional(),
      embeddingModel: ModelSelectionSchema.optional(),
      stt: SttConfigSchema.prefault({}),
    })
    .prefault({}),
  agent: z
    .object({
      // A mode written by an older build (e.g. the removed 'plan') falls back instead of
      // failing the whole config, which would discard the user's providers and keys.
      permissionMode: PermissionModeSchema.catch('ask').default('ask'),
      allowAlways: z.array(z.string()).default([]),
      /** `shell` tool containment: 'auto' = the OS sandbox when available (macOS seatbelt), 'off' = never. */
      shellSandbox: z.enum(['auto', 'off']).catch('auto').default('auto'),
      maxStepsPerTurn: z.number().int().min(1).max(200).default(40),
      compactionThreshold: z.number().min(0.5).max(0.95).default(0.8),
      turnTimeoutMs: z
        .number()
        .int()
        .positive()
        .default(20 * 60_000),
    })
    .prefault({}),
  memory: z
    .object({
      autoWrite: z.boolean().default(true),
      confirmBeforeWrite: z.boolean().default(false),
      maxEntries: z.number().int().min(10).max(2000).default(200),
    })
    .prefault({}),
  diary: z
    .object({
      enabled: z.boolean().default(true),
      hour: z.number().int().min(0).max(23).default(2),
      customPrompt: z.string().optional(),
    })
    .prefault({}),
  autoReply: z
    .object({
      /** Grace period between "draft ready" and "sent", during which the user can cancel it. */
      countdownMs: z.number().int().min(0).max(60_000).default(5000),
    })
    .prefault({}),
  /** AI 宠物 (Codex Pets): the companion perched above the Agent composer. */
  pet: z
    .object({
      enabled: z.boolean().default(true),
      /** Folder under <dataRoot>/pets; unset (or no longer installed) → the first bundled pet. */
      current: z.string().regex(PET_ID_PATTERN).optional().catch(undefined),
      /** One-line status bubble next to the pet (thinking / needs you / done / failed). */
      bubbles: z.boolean().default(true),
      /** Animate; off keeps a still pose (prefers-reduced-motion also forces this). */
      motion: z.boolean().default(true),
      /** Occasional wave / hop while idle. */
      idleFlair: z.boolean().default(true),
      size: z.enum(['sm', 'md', 'lg']).default('md').catch('md'),
    })
    .prefault({}),
  onboarding: z.object({ completed: z.boolean().default(false) }).prefault({}),
  ui: z
    .object({
      /**
       * Which layout the window shows after onboarding: the four-column workbench, or the Agent window
       * (sidebar of threads + full-width conversation + on-demand workspace pane). Remembered across launches.
       */
      shellMode: ShellModeSchema.default('workbench').catch('workbench'),
      agentPanelCollapsed: z.boolean().default(false),
      objectListCollapsed: z.boolean().default(false),
      agentPanelWidth: z.number().int().min(320).max(640).default(360),
      objectListWidth: z.number().int().min(240).max(400).default(280),
      agentWindowSidebarCollapsed: z.boolean().default(false),
      agentWindowSidebarWidth: z.number().int().min(220).max(400).default(260),
      agentWindowWorkspaceWidth: z.number().int().min(400).max(1200).default(560),
    })
    .prefault({}),
})

export type AppConfig = z.infer<typeof AppConfigSchema>
export type ProviderConfig = z.infer<typeof ProviderSchema>
export type ModelEntry = z.infer<typeof ModelEntrySchema>
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>
export type ModelSelection = z.infer<typeof ModelSelectionSchema>
export type PetConfig = AppConfig['pet']
export type ShellMode = z.infer<typeof ShellModeSchema>

export const defaultConfig = (): AppConfig => AppConfigSchema.parse({})

/** Deep-partial patch type used by config:set. */
export type ConfigPatch = {
  [K in keyof AppConfig]?: AppConfig[K] extends object ? Partial<AppConfig[K]> : AppConfig[K]
}
