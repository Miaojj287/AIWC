/**
 * IPC channels for MCP servers, user hooks and workflows. Kept out of ipc.ts so the core contract stays under the size limit; ipc.ts
 * merges these into InvokeMap / EventMap and the channel allow-lists.
 *
 * Every request is re-validated in main (`electron/main/ipc/extensions.ts`): these channels name commands the app runs.
 */
import type {
  ExtensionSaveResult,
  McpServerDraft,
  McpServerStatus,
  McpServerView,
  McpToolRisk,
  UserHookDraft,
  UserHookTestResult,
  UserHookView,
} from '../extensions'

/** Invoke channels (MCP servers, user hooks and workflows). */
export interface ExtensionsInvokeMap {
  'mcp:list': { req: void; res: McpServerView[] }
  /** New or changed commands / URLs ask for a native confirmation first; declining returns `not_confirmed`. */
  'mcp:save': { req: McpServerDraft; res: ExtensionSaveResult<McpServerView> }
  'mcp:remove': { req: { id: string }; res: void }
  'mcp:setEnabled': { req: { id: string; enabled: boolean }; res: McpServerView }
  /** Reconnect and list the tools again (also 测试连接). */
  'mcp:restart': { req: { id: string }; res: McpServerView }
  /** `risk: null` clears the override (back to the server default). */
  'mcp:setToolPolicy': {
    req: { id: string; tool: string; risk?: McpToolRisk | null; disabled?: boolean }
    res: McpServerView
  }
  /** `sandbox`: this OS can contain hook commands (macOS seatbelt) and the shell sandbox is not switched off. */
  'hooks:list': { req: void; res: { hooks: UserHookView[]; sandbox: boolean } }
  'hooks:save': { req: UserHookDraft; res: ExtensionSaveResult<UserHookView> }
  'hooks:remove': { req: { id: string }; res: void }
  'hooks:setEnabled': { req: { id: string; enabled: boolean }; res: UserHookView }
  /** Run the hook once with a sample payload of its event. */
  'hooks:test': { req: { id: string }; res: UserHookTestResult }
}

/** Push events (MCP servers, user hooks and workflows). */
export interface ExtensionsEventMap {
  'mcp:status': McpServerStatus
}

export const EXTENSIONS_INVOKE_CHANNELS = [
  'mcp:list',
  'mcp:save',
  'mcp:remove',
  'mcp:setEnabled',
  'mcp:restart',
  'mcp:setToolPolicy',
  'hooks:list',
  'hooks:save',
  'hooks:remove',
  'hooks:setEnabled',
  'hooks:test',
] as const satisfies readonly (keyof ExtensionsInvokeMap)[]
export const EXTENSIONS_EVENT_CHANNELS = ['mcp:status'] as const satisfies readonly (keyof ExtensionsEventMap)[]
