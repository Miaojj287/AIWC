/**
 * @aiwc/gateway — channel layer (docs/ARCHITECTURE.md §7, docs/PACKAGE-API.md "@aiwc/gateway").
 */
export { buildSessionKey } from './session/sessionKey'

export { createObservedBuffer } from './observed/observedBuffer'

export { createGateway } from './core/gateway'
export type { Gateway } from './core/gateway'

export { createIlinkAdapter } from './adapters/ilink/adapter'

export { createDesktopAdapter } from './adapters/desktop/desktopAdapter'

export { createUiInjectSender } from './send/uiInject/uiInjectSender'
export type { UiInjectSender } from './send/uiInject/uiInjectSender'

export { createAutoReplyRecordStore } from './autoreply/recordStore'
export type { AutoReplyRecordStore } from './autoreply/recordStore'
export { createAutoReplyService } from './autoreply/autoReplyService'
export type { AutoReplyService } from './autoreply/autoReplyService'

export { gatewayTools } from './tools/gatewayTools'
export type { DraftHandoff } from './tools/gatewayTools'
