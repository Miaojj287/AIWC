/**
 * @aiwc/shell — running commands on the user's machine (docs/ARCHITECTURE.md §6.1): the argv-only
 * process runner with process-group kill, the login-shell environment, command classification for the
 * approval matrix, the macOS seatbelt sandbox, and the `shell` agent tool built from them.
 */
export { runProcess, stripAnsi, killAllCliProcesses } from './process'
export type { RunOptions, RunResult } from './process'
export { createCliEnv, probeLoginShellPath, resolveCommand, wellKnownBinDirs } from './env'
export type { CliEnv, CliEnvOptions, NodeRuntime, ResolvedCommand } from './env'
export { classifyCommand, splitCommand, maxRisk } from './classify'
export type { ClassifyOptions, CommandPolicy, CommandSegment, SegmentClassifier } from './classify'
export { createSandbox, seatbeltProfile, SEATBELT_DENIED_RE } from './sandbox'
export type { Sandbox, SandboxSpec, WrappedCommand } from './sandbox'
export { createShellTool, shellCommandFor, SHELL_DEFAULT_TIMEOUT_MS, SHELL_MAX_TIMEOUT_MS } from './shellTool'
export type { ShellInput, ShellOutput, ShellToolDeps } from './shellTool'
