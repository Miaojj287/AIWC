/**
 * Persistent app configuration (zod-validated). Secrets are NOT stored here: fields ending in
 * `Ref` point into the OS-backed secret store (electron safeStorage).
 */
import { z } from 'zod'
import { mixPaletteColors } from './appearance'
import { JEV_DEFAULT_BASE_URL, JEV_DEFAULT_MODEL } from './jev'
import { CallLogConfigSchema, ProxyConfigSchema } from './modelNetwork'
import { PET_ID_PATTERN } from './pet'
import {
  DEFAULT_TODO_SCHEDULE,
  TODO_DEFAULT_MAX_MESSAGES,
  TODO_MAX_SOURCES,
  TodoScheduleSchema,
  TodoSourceSchema,
} from './todo'

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
  return {
    ...value,
    surface: mixPaletteColors(value.background, value.foreground, 0.04 + (value.contrast / 100) * 0.127),
  }
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
/** Which key sends from the Agent composer (设置 › 常规 or the composer's ＋ menu). */
export const ComposerSendKeySchema = z.enum(['enter', 'modEnter'])
export type ComposerSendKey = z.infer<typeof ComposerSendKeySchema>

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
  /** Accepts images (API metadata or a known profile); the model's own supportsVision is the user's override. */
  vision: z.boolean().optional(),
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

/** 设置 › AI 接入 › Jev: the decision model behind 自动回复的 Jev（beta）回复方式. The key lives in the secret store. */
export const JevConfigSchema = z.object({
  baseUrl: z.string().default(JEV_DEFAULT_BASE_URL),
  model: z.string().min(1).default(JEV_DEFAULT_MODEL),
  apiKeyRef: z.string().optional(),
  lastTest: ProviderTestSchema.optional(),
})
export type JevConfig = z.infer<typeof JevConfigSchema>

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
      /**
       * 系统通知: while the window is in the background, things waiting for the user (an approval, a reply draft, a
       * paused auto reply, a finished task) also raise an OS notification. Names stay out of it unless `showNames`
       * (the lock screen and notification centre keep them).
       */
      notifications: z
        .object({ enabled: z.boolean().default(true), showNames: z.boolean().default(false) })
        .prefault({}),
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
      jev: JevConfigSchema.prefault({}),
      /** 网络: proxy for requests to model providers (loopback / Ollama always direct). */
      proxy: ProxyConfigSchema.prefault({}),
      /** 调用记录: whether request / response content is kept with each logged call (off by default). */
      callLog: CallLogConfigSchema.prefault({}),
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
      /** 设置 › 技能: skills switched off by name — not offered to the model or in the `/` menu. */
      disabledSkills: z.array(z.string().max(80)).max(500).default([]).catch([]),
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
  /**
   * 每日待办: opt-in (off by default). While on, the picked group chats' new messages are sent to `model`
   * (the default model when unset) on `schedule`; todos and summaries stay on this machine. A scan never
   * reads a chat that is not in `sources`. Replaced the nightly 日记 pipeline (`diary`, dropped on load).
   */
  todo: z
    .object({
      enabled: z.boolean().default(false),
      sources: z.array(TodoSourceSchema).max(TODO_MAX_SOURCES).default([]).catch([]),
      schedule: TodoScheduleSchema.default(DEFAULT_TODO_SCHEDULE).catch(DEFAULT_TODO_SCHEDULE),
      model: ModelSelectionSchema.optional().catch(undefined),
      maxMessagesPerSource: z
        .number()
        .int()
        .min(20)
        .max(500)
        .default(TODO_DEFAULT_MAX_MESSAGES)
        .catch(TODO_DEFAULT_MAX_MESSAGES),
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
      /** Status readout beside the pet (Codex-style): Agent threads running or waiting for the user. */
      showRunning: z.boolean().default(true),
      /** …threads that finished (or failed) while the user was not looking, until they open them. */
      showDone: z.boolean().default(true),
      /** …unread WeChat messages in chats that are not muted or folded. */
      showUnread: z.boolean().default(true),
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
      /** Agent composer: `enter` sends (⇧↵ newline), `modEnter` sends with ⌘↵ / Ctrl+Enter (↵ newline). */
      composerSendKey: ComposerSendKeySchema.default('enter').catch('enter'),
    })
    .prefault({}),
})

export type AppConfig = z.infer<typeof AppConfigSchema>
export type ProviderConfig = z.infer<typeof ProviderSchema>
export type ModelEntry = z.infer<typeof ModelEntrySchema>
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>
export type ModelSelection = z.infer<typeof ModelSelectionSchema>
export type PetConfig = AppConfig['pet']
export type TodoConfig = AppConfig['todo']
export type ShellMode = z.infer<typeof ShellModeSchema>

export const defaultConfig = (): AppConfig => AppConfigSchema.parse({})

/** Deep-partial patch type used by config:set. */
export type ConfigPatch = {
  [K in keyof AppConfig]?: AppConfig[K] extends object ? Partial<AppConfig[K]> : AppConfig[K]
}
