/**
 * Persistent app configuration (zod-validated). Secrets are NOT stored here: fields ending in
 * `Ref` point into the OS-backed secret store (electron safeStorage).
 */
import { z } from 'zod'

export const ThemeSchema = z.enum(['dark', 'light', 'system'])
export const CloseBehaviorSchema = z.enum(['quit', 'minimize', 'ask'])
export const PermissionModeSchema = z.enum(['ask', 'bypass'])

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
      launchAtLogin: z.boolean().default(false),
      closeBehavior: CloseBehaviorSchema.default('ask'),
      language: z.enum(['zh-CN']).default('zh-CN'),
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
      maxStepsPerTurn: z.number().int().min(1).max(200).default(40),
      compactionThreshold: z.number().min(0.5).max(0.95).default(0.8),
      turnTimeoutMs: z.number().int().positive().default(20 * 60_000),
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
  onboarding: z.object({ completed: z.boolean().default(false) }).prefault({}),
  ui: z
    .object({
      agentPanelCollapsed: z.boolean().default(false),
      objectListCollapsed: z.boolean().default(false),
      agentPanelWidth: z.number().int().min(320).max(640).default(360),
      objectListWidth: z.number().int().min(240).max(400).default(280),
    })
    .prefault({}),
})

export type AppConfig = z.infer<typeof AppConfigSchema>
export type ProviderConfig = z.infer<typeof ProviderSchema>
export type ModelEntry = z.infer<typeof ModelEntrySchema>
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>
export type ProviderTest = z.infer<typeof ProviderTestSchema>
export type ModelSelection = z.infer<typeof ModelSelectionSchema>

export const defaultConfig = (): AppConfig => AppConfigSchema.parse({})

/** Deep-partial patch type used by config:set. */
export type ConfigPatch = {
  [K in keyof AppConfig]?: AppConfig[K] extends object ? Partial<AppConfig[K]> : AppConfig[K]
}
