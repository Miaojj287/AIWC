/**
 * Single tool registry. Profiles decide the mounting surface; `forProfile` applies the deny list,
 * the depth rule (no delegation from inside a subagent) and the per-profile hardening rules
 * (wechat-bot, subagent, persona) on top of whatever the tool definitions declare.
 */
import type { AnyToolDefinition, ToolProfile } from '@aiwc/protocol'
import type { ToolRegistry } from '../ports'

/** Tools a WeChat bot thread may keep even though they are not read-only: they enforce origin-only sending themselves. */
export const SEND_TO_ORIGIN_TOOLS: readonly string[] = ['send_message', 'send_media']

/** Tools that spawn sub-agents; stripped when depth > 0 so a subagent cannot recurse. */
export const DELEGATION_TOOLS: readonly string[] = ['delegate_analysis']

type AnyTool = AnyToolDefinition

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

/**
 * Belt and braces over what definitions declare (ARCHITECTURE §6): wechat-bot only ever sees read tools plus the
 * send-to-origin pair; a subagent is read-only, so a definition that lists it by mistake still cannot hand a
 * delegate child a write; persona threads role-play and run no tools at all.
 */
function allowedForProfile(profile: ToolProfile, tool: AnyTool): boolean {
  switch (profile) {
    case 'desktop-chat':
    case 'cron':
      return true
    case 'wechat-bot':
      return tool.risk === 'read' || SEND_TO_ORIGIN_TOOLS.includes(tool.name)
    case 'subagent':
      return tool.risk === 'read'
    case 'persona':
      return false
  }
}

function sortByName(list: AnyTool[]): AnyTool[] {
  return list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}
