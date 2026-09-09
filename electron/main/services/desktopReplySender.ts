import { join } from 'node:path'
import { createBackgroundAxInjector, createUiInjectSender, type UiInjectSenderDeps } from '@aiwc/gateway'

/** Production entry for this branch. An omitted injector must never enable global keyboard input. */
export function createDesktopReplySender(deps: Omit<UiInjectSenderDeps, 'injector'> & {
  nativeDir: string
  dataRoot: string
  profilePath?: string
}) {
  const { nativeDir, dataRoot, profilePath, ...senderDeps } = deps
  return createUiInjectSender({
    ...senderDeps,
    injector: createBackgroundAxInjector({
      helperPath: deps.platform === 'darwin' ? join(nativeDir, 'aiwc-background-helper') : undefined,
      profilePath: profilePath ?? join(dataRoot, 'background-reply', 'profile.json'),
    }),
  })
}
