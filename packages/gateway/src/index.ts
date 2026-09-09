/**
 * @aiwc/gateway — channel layer (docs/ARCHITECTURE.md §7, docs/PACKAGE-API.md "@aiwc/gateway").
 */
export { buildSessionKey, parseSessionKey } from './session/sessionKey'
export { createReplyGate, isSelfSent } from './gate/replyGate'
export type { ReplyGate, ReplyGateDeps, ReplyReason } from './gate/replyGate'
export {
  createObservedBuffer,
  formatObservedLine,
  renderObservedLines,
  OBSERVED_FRAGMENT_KIND,
  OBSERVED_FRAGMENT_MARKER,
  OBSERVED_FRAGMENT_TOKEN_CAP,
} from './observed/observedBuffer'
export type { ObservedBuffer, ObservedBufferOptions } from './observed/observedBuffer'
export { createGateway, defaultIsAllowed } from './core/gateway'
export type { Gateway, GatewayDeps, InboundHandler, AdapterExtras } from './core/gateway'
export { withOriginGuard, sourceFromOrigin, isWechatChannel, isBotChannel, sendChannelForOrigin, inferChatType, OriginViolationError, OBSERVED_SEND_CHANNEL } from './core/originGuard'
export type { Origin } from './core/originGuard'
export { checkOutboundMedia, canonicalPath, isWithinRoot, isWithinRoots, resolveMediaRoots, MEDIA_ROOTS_MISSING_ERROR, MEDIA_PATH_NOT_ABSOLUTE_ERROR } from './core/mediaPolicy'
export type { MediaRoots, MediaPolicyVerdict } from './core/mediaPolicy'
export { createEmitter } from './core/emitter'
export type { Emitter } from './core/emitter'

export { createIlinkAdapter, ilinkSource } from './adapters/ilink/adapter'
export type { IlinkAdapter, IlinkAdapterOptions } from './adapters/ilink/adapter'
export { createIlinkClient, buildSendMessageBody } from './adapters/ilink/client'
export type { IlinkClient, IlinkClientOptions } from './adapters/ilink/client'
export { parseIncomingMessage, incomingText, incomingKind, messageKey, isSessionExpiredError, ILINK_TEXT_BUBBLE_SEPARATOR, ILINK_MAX_TEXT_LENGTH } from './adapters/ilink/protocol'
export type { IlinkSession, IlinkMessage, IlinkUpdates, IlinkAttachment } from './adapters/ilink/protocol'
export { splitExplicitBubbles, chunkText, shapeOutboundText } from './adapters/ilink/textSplit'
export { createIlinkSessionStore } from './adapters/ilink/sessionStore'
export type { IlinkSessionStore, StoredIlinkSession } from './adapters/ilink/sessionStore'
export { createDesktopAdapter, desktopSource, DESKTOP_SELF_PEER } from './adapters/desktop/desktopAdapter'
export type { DesktopAdapter } from './adapters/desktop/desktopAdapter'

export { createUiInjectSender } from './send/uiInject/uiInjectSender'
export type { UiInjectSender, UiInjectSenderDeps, VerifyVerdict } from './send/uiInject/uiInjectSender'
export { createInjector, createDarwinInjector, createWin32Injector, createNoopInjector, InjectorError, INJECT_FAILURE_TEXT } from './send/uiInject/injectors'
export type { WeChatInjector, InjectFailure } from './send/uiInject/injectors'

export { createAutoReplyRecordStore } from './autoreply/recordStore'
export type { AutoReplyRecordStore, RecordQuery } from './autoreply/recordStore'
export { createAutoReplyService, RECALL_WINDOW_MS } from './autoreply/autoReplyService'
export type { AutoReplyService, AutoReplyServiceDeps, GenerateContext } from './autoreply/autoReplyService'
export { substituteTemplate, templateVars, formatClock } from './autoreply/template'
export type { TemplateVars } from './autoreply/template'

export { gatewayTools, resolveTarget, checkMediaPath, isBotContext } from './tools/gatewayTools'
export type { GatewayToolServices, GatewayToolsOptions, DraftHandoff } from './tools/gatewayTools'

export { createFakeAdapter, fakeEvent } from './testing/fakeAdapter'
export type { FakeAdapter } from './testing/fakeAdapter'

export { createBackgroundAxInjector } from './send/uiInject/injectors/backgroundAx'
