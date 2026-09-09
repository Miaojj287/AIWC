/**
 * Vendor presets for 设置 › AI 接入 (Figma 164:4211 模型厂商 list). A preset is the request format
 * (`kind`), the default endpoint, where to get a key, and the key console URL.
 * No static model IDs: the 接入 dialog discovers the live catalogue.
 * Pure data — no React, no bridge.
 */
import type { ProviderKind } from '@aiwc/protocol'

export type VendorId = 'deepseek' | 'kimi' | 'glm' | 'qwen' | 'minimax' | 'hunyuan' | 'seed' | 'openai' | 'anthropic' | 'google' | 'ollama'

export interface VendorPreset {
  id: VendorId
  label: string
  /** One-line platform name shown under the vendor (智谱开放平台 …). */
  subtitle: string
  kind: ProviderKind
  baseUrl: string
  /** Console page where the user creates an API key (前往官网获取). */
  keyUrl?: string
  /** Inference never leaves the machine — no key, 本地 badge. */
  local?: boolean
}

export const VENDORS: readonly VendorPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    subtitle: 'DeepSeek 开放平台',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'kimi',
    label: 'Kimi',
    subtitle: 'Moonshot 开放平台',
    kind: 'openai-compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'glm',
    label: 'GLM',
    subtitle: '智谱开放平台',
    kind: 'openai-compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'qwen',
    label: 'Qwen',
    subtitle: '阿里云百炼',
    kind: 'openai-compatible',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    subtitle: 'MiniMax 开放平台',
    kind: 'openai-compatible',
    baseUrl: 'https://api.minimaxi.com/v1',
    keyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
  },
  {
    id: 'hunyuan',
    label: 'Hunyuan',
    subtitle: '腾讯混元',
    kind: 'openai-compatible',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    keyUrl: 'https://console.cloud.tencent.com/hunyuan/api-key',
  },
  {
    id: 'seed',
    label: 'Seed',
    subtitle: '火山方舟 · 豆包',
    kind: 'openai-compatible',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    subtitle: 'OpenAI Platform',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    subtitle: 'Claude API',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'google',
    label: 'Gemini',
    subtitle: 'Google AI Studio',
    kind: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    subtitle: '本地运行，数据不出本机',
    kind: 'ollama',
    baseUrl: 'http://localhost:11434',
    local: true,
  },
]

export const vendorById = (id: string | undefined): VendorPreset | undefined => (id ? VENDORS.find((v) => v.id === id) : undefined)

