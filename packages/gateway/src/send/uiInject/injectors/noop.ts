import { InjectorError, type WeChatInjector } from './types'

/** Used on unsupported platforms: every call fails fast so the sender halts with a clear reason. */
export function createNoopInjector(): WeChatInjector {
  const fail = async (): Promise<never> => {
    throw new InjectorError('unsupported')
  }
  return { focusSession: fail, fill: fail, commit: fail }
}
