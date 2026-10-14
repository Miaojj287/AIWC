import { t } from '../i18n'
import { existsSync } from 'node:fs'
import { PROXY_PASSWORD_SECRET_REF, type AppConfig, type AccountTarget } from '@aiwc/protocol'
import { createConfigService, type ConfigService } from '../config/configService'
import { createSecretStore, type SafeStorageLike, type SecretStore } from '../config/secretStore'
import type { AppContext } from '../contracts'
import type { AppPaths } from '../paths'
import { accountProfileId, prepareAccountProfile, type AccountProfile } from './accountProfiles'

/** Credential staging never rewrites the active owner's config or secret store. */
export interface AccountCredentials {
  config: ConfigService
  secrets: SecretStore
}
/** Main-process-only profile operations used by account IPC. */
export interface AccountSession {
  credentials(target?: AccountTarget): AccountCredentials
  switch(target: AccountTarget): void
  isSwitching(): boolean
}

function copyReferencedSecrets(
  source: SecretStore,
  target: SecretStore,
  config: AppConfig,
  includeAccount: boolean,
): void {
  const refs = [
    ...config.ai.providers.map((provider) => provider.apiKeyRef),
    config.ai.jev.apiKeyRef,
    PROXY_PASSWORD_SECRET_REF,
    ...(includeAccount
      ? [
          config.account.dbKeyRef,
          config.account.dbCredentialsRef,
          config.account.imageXorKeyRef,
          config.account.imageAesKeyRef,
        ]
      : []),
  ]
  for (const ref of refs) {
    if (!ref || target.has(ref)) continue
    const value = source.reveal(ref)
    if (value) target.set(ref, value)
  }
}

/** Seed referenced credentials only; never copy channel tokens, MCP credentials or historical content. */
export function seedProfileSecrets(base: AppPaths, profile: AppPaths, safeStorage: SafeStorageLike): void {
  if (existsSync(profile.secretsFile) || !existsSync(base.secretsFile)) return
  const config = createConfigService({ file: profile.configFile }).get()
  copyReferencedSecrets(
    createSecretStore({ file: base.secretsFile, safeStorage }),
    createSecretStore({ file: profile.secretsFile, safeStorage }),
    config,
    createConfigService({ file: base.configFile }).get().account.wxid === config.account.wxid,
  )
}

/** A process owns one immutable profile; switching commits the selection then restarts the whole runtime. */
export function createAccountSession(deps: {
  base: AppPaths
  profile: AccountProfile
  context: Pick<AppContext, 'config' | 'secrets'> & {
    tasks: Pick<AppContext['tasks'], 'stop'>
    todo: Pick<AppContext['todo'], 'dispose'>
    mobile: Pick<AppContext['mobile'], 'dispose'>
  }
  safeStorage: SafeStorageLike
  restart(): void
}): AccountSession {
  let switching = false
  const staged = new Map<string, AccountCredentials>()
  const credentials = (target?: AccountTarget): AccountCredentials => {
    if (!target || accountProfileId(target.wxid) === deps.profile.paths.accountScope) return deps.context
    const id = accountProfileId(target.wxid)
    const cached = staged.get(id)
    if (cached) return cached
    const source = deps.context.config.get()
    const paths = prepareAccountProfile(deps.base, { ...source, account: target })
    const config = createConfigService({ file: paths.configFile })
    const secrets = createSecretStore({ file: paths.secretsFile, safeStorage: deps.safeStorage })
    copyReferencedSecrets(deps.context.secrets, secrets, config.get(), false)
    const result = { config, secrets }
    staged.set(id, result)
    return result
  }
  return {
    credentials,
    isSwitching: () => switching,
    switch(target) {
      if (switching) throw new Error(t('main.substrate.switchingAccount'))
      const selected = credentials(target).config.get()
      deps.profile.select({ ...selected, account: { ...selected.account, ...target, verifiedAt: Date.now() } })
      switching = true
      // Prevent another timer or queued retry before Electron starts its shutdown sequence.
      deps.context.tasks.stop()
      deps.context.todo.dispose()
      deps.context.mobile.dispose()
      deps.restart()
    },
  }
}
