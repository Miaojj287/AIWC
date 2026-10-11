/**
 * @aiwc/shell — running commands on the user's machine (docs/ARCHITECTURE.md §6.1): the argv-only
 * process runner with process-group kill, the login-shell environment, command classification for the
 * approval matrix, the macOS seatbelt sandbox, and the `shell` agent tool built from them.
 *
 * The entry exports only what other layers use — the office connectors run vendor CLIs through the
 * runner and contribute a classifier, and the composition root mounts the tool. Everything else is
 * internal to the package and imported by path inside it.
 */
export { runProcess, killAllCliProcesses } from './process'
export type { RunResult } from './process'
export { createCliEnv, resolveCommand } from './env'
export type { CliEnv, NodeRuntime } from './env'
export type { SegmentClassifier } from './classify'
export { createShellTool, shellCommandFor } from './shellTool'
export { createSandbox } from './sandbox'
export type { Sandbox } from './sandbox'
