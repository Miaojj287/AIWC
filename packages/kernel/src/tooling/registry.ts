/**
 * Single tool registry. Profiles decide the mounting surface; `forProfile` applies the deny list,
 * the depth rule (no delegation from inside a subagent) and the wechat-bot hardening rule on top
 * of whatever the tool definitions declare.
 */
import type { ToolDefinition, ToolProfile } from '@aiwc/protocol'
import type { ToolRegistry } from '../ports'

/** Tools a WeChat bot thread may keep even though they are not read-only: they enforce origin-only sending themselves. */
export const SEND_TO_ORIGIN_TOOLS: readonly string[] = ['send_message', 'send_media']

/** Tools that spawn sub-agents; stripped when depth > 0 so a subagent cannot recurse. */
export const DELEGATION_TOOLS: readonly string[] = ['delegate_analysis']

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = ToolDefinition<any, any>

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, AnyTool>()

  return {
    register(tool) {
      if (tools.has(tool.name)) throw new Error(`tool already registered: ${tool.name}`)
      tools.set(tool.name, tool)
    },
    unregister(name) {
      tools.delete(name)
    },
    get(name) {
      return tools.get(name)
    },
    list() {
      return sortByName([...tools.values()])
    },
    forProfile(profile, opts) {
      const deny = new Set(opts?.deny ?? [])
      const depth = opts?.depth ?? 0
      const out: AnyTool[] = []
      for (const tool of tools.values()) {
        if (!tool.profiles.includes(profile)) continue
        if (deny.has(tool.name)) continue
        if (depth > 0 && DELEGATION_TOOLS.includes(tool.name)) continue
        if (!allowedForProfile(profile, tool)) continue
        out.push(tool)
      }
      return sortByName(out)
    },
  }
}

/** Belt and braces: wechat-bot only ever sees read tools plus the send-to-origin pair. */
function allowedForProfile(profile: ToolProfile, tool: AnyTool): boolean {
  if (profile !== 'wechat-bot') return true
  if (tool.risk === 'read') return true
  return SEND_TO_ORIGIN_TOOLS.includes(tool.name)
}

function sortByName(list: AnyTool[]): AnyTool[] {
  return list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}
