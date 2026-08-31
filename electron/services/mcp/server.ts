import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getAppVersion } from '../runtimePaths'
import { registerAIWCMcpTools } from './tools'

export function createAIWCMcpServer() {
  const server = new McpServer({
    name: 'aiwc-mcp',
    version: getAppVersion()
  })

  registerAIWCMcpTools(server)
  return server
}
