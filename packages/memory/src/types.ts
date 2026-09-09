/**
 * Package-local types. FragmentProvider / FragmentProviderContext live in @aiwc/protocol (the kernel's
 * ports.ts re-exports the same); internal modules import them from there and the barrel re-exports them.
 */
import type { ToolDefinition, ToolServices } from '@aiwc/protocol'

/** Tool definitions with heterogeneous input types, as the registry consumes them. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDefinition<S extends ToolServices = ToolServices> = ToolDefinition<any, S>
