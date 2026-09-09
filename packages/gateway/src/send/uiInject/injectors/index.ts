import { createDarwinInjector } from './darwin'
import { createNoopInjector } from './noop'
import { createWin32Injector } from './win32'
import type { WeChatInjector } from './types'

export * from './types'
export { createDarwinInjector, createNoopInjector, createWin32Injector }

export function createInjector(platform: string): WeChatInjector {
  if (platform === 'darwin') return createDarwinInjector()
  if (platform === 'win32') return createWin32Injector()
  return createNoopInjector()
}
