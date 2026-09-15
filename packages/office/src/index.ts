/**
 * @aiwc/office — 飞书 / 钉钉 / 企业微信 connectors built on each vendor's official CLI
 * (docs/ARCHITECTURE.md §14): connection status, browser-authorization sessions, table pushes,
 * push history and the agent tools on top of them.
 */
export { createOfficeService } from './service'
export type { OfficeService } from './service'
export { officeTools } from './tools/officeTools'
