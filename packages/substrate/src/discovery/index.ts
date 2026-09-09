export { detectWeChat, listAccounts, verifyAccount, type DetectWeChatResult, type VerifyAccountOptions } from './accounts'
export {
  currentRootEnv,
  defaultDbRootHint,
  defaultRootCandidates,
  detectDbRoot,
  isMacVersionDir,
  isPotentialAccountName,
  listAccountDirs,
  scoreRootCandidates,
  type DbRootCandidate,
  type RootEnv,
} from './dbRoots'
export {
  findWeChatPidSync,
  listWeChatProcesses,
  listWeChatProcessesSync,
  parseMacPsOutput,
  parseVersionString,
  parseWindowsTasklist,
  readWeChatVersion,
  type WeChatProcessInfo,
} from './processDetect'
