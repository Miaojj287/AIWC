export * from './ports'
export * from './runtime'
export * from './tooling'
// Explicit re-exports resolve star-export ambiguity (TS2308):
//  - createFragment: runtime re-exports the @aiwc/protocol implementation (fragments.ts, PACKAGE-API 补充约定);
//    tooling still ships a local copy, so the runtime path is the one exported here.
//  - ToolRouterBuildOptions: ports.ts is the contract; tooling/router.ts widens it compatibly.
export { createFragment } from './runtime'
export type { ToolRouterBuildOptions } from './ports'
