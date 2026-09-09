export { createWcdbSourceReader, WcdbSourceReader, type WcdbSourceReaderOptions } from './wcdbSourceReader'
export { NativeMissingError, resolveWcdbLibrary, wcdbLibraryCandidates, resolveOptionalNative, platformArchDir } from './nativeLib'
export { OpenWcdbBridge, type SqlParam, type WcdbQueryResult } from './openWcdbBridge'
export { type WcdbQuery, createBridgeQuery, quoteIdent, yieldToLoop } from './query'
export {
  findMediaDbs,
  findMessageShards,
  findNamedDb,
  findSessionDbCandidates,
  isAccountDir,
  resolveAccountDir,
  resolveDbStoragePath,
  accountModifiedTime,
  type MessageShard,
  type MessageShardKind,
} from './dbFiles'
export {
  buildIdentityKeys,
  classifySessionKind,
  classifyContactKind,
  cleanAccountDirName,
  isGroupUsername,
  isOfficialAccountUsername,
  isSystemUsername,
  shouldKeepSession,
} from './accountUtils'
export * from './rowDecoders'
export * from './contentParsers'
export {
  classifyKind,
  deriveSeq,
  extractMediaLocator,
  messageIdentityKey,
  readRawInfo,
  resolveIsSelf,
  resolveLocalType,
  rowToWxMessage,
  splitLocalType,
  type MediaLocator,
  type MessageRawInfo,
  type MessageRowContext,
} from './messageMapper'
export { MessageTableIndex, messageTableHash, extractMessageTableHash, type MessageTableRef, type MessageTableColumns } from './tableResolver'
export { queryMessagesAfter, queryMessagesBefore, findMessageRow, seqExpression, type MessageQueryContext } from './messageQueries'
export { querySessions, rowToWxSession, resolveSessionTable, querySessionsChangedSince } from './sessionQueries'
export { ContactDirectory, type ContactRecord } from './contactQueries'
export { resolveMediaFor, mediaCachePath, datBaseName, isThumbDat, rankDatCandidates, type MediaResolverContext, type MediaTarget } from './mediaResolver'
export { assertReadOnlySql, wrapWithLimit, stripSqlNoise } from './querySql'
export { watchDbDirs, isRelevantDbFile, createDebouncedCollector } from './watcher'
