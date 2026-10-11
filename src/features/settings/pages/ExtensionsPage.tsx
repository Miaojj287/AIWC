/**
 * 设置 › 扩展: MCP servers (outside tools for the Agent) and user hooks (commands on Agent events). The sections own their data; this page only lays them out.
 */
import { HooksSection } from './extensions/HooksSection'
import { McpSection } from './extensions/McpSection'

export function ExtensionsPage() {
  return (
    <>
      <McpSection />
      <HooksSection />
    </>
  )
}
