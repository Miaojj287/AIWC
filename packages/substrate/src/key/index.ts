export { acquireKeys, type AcquireKeysOptions, type AcquireKeysResult } from './acquireKeys'
export { validateKeyHex, validateKeyHexDetailed, validateXorKeyHex, validateAesKeyHex, normalizeKeyHex, type KeyHexValidation } from './validateKeyHex'
export {
  classifyKeyAgainstPage,
  deriveSqlcipherKey,
  isPlaintextSqlitePage,
  isValidKeyHex,
  readEncryptedDbSalt,
  readFirstPage,
  verifyDbKey,
  type DbKeyForm,
  type DbKeyVerification,
} from './sqlcipherPage'
export { extractMemoryDbKeyCandidates, extractRawV4KeyCandidates, matchCandidateToSalts, type MemoryDbKeyCandidate } from './memoryDbKeyPattern'
export { collectEncryptedDbSalts } from './salts'
export { collectKvcommCodes, deriveImageKeys, resolveImageKeys, scanImageTemplates, verifyImageAesKey, type ImageKeyResult, type TemplateScan } from './imageKeys'
export { scanMacDbKey, scanMacDbKeyFromDumps, scanMacImageAesKey, captureMacDbKeyViaHook, isSipEnabled, type MacScanResult, type MacHookCaptureResult } from './macosMemoryScanner'
export { scanWindowsDbKey, scanWindowsImageAesKey, findWindowsImageAesKey, verifyWindowsImageAesKey, type WindowsDbKeyScanResult } from './windowsMemoryScanner'
