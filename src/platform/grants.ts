/**
 * How a 总是允许 grant reads to the user. A key is a tool name (`remember`) or a tool plus a command prefix
 * (`shell:git commit`): the approval card and 设置 › 权限规则 name it the same way.
 */
import { t } from '@/i18n'

/** The command prefix of a `shell:<prefix>`-style key, else undefined. */
export function grantPrefix(key: string): string | undefined {
  const at = key.indexOf(':')
  return at > 0 ? key.slice(at + 1) : undefined
}

/** One phrase for a grant key: 以「git commit」开头的命令 / 工具 remember. */
export function grantLabel(key: string): string {
  const prefix = grantPrefix(key)
  return prefix ? t('app.grants.command', { prefix }) : t('app.grants.tool', { name: key })
}
