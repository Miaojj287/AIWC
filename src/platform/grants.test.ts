import { afterEach, describe, expect, it } from 'vitest'
import { __resetLanguageForTests, setLanguage } from '@/i18n'
import { grantLabel, grantPrefix } from './grants'

afterEach(() => __resetLanguageForTests())

describe('grant labels', () => {
  it('names a command-prefix grant by its prefix and a tool grant by the tool', () => {
    expect(grantPrefix('shell:git commit')).toBe('git commit')
    expect(grantPrefix('remember')).toBeUndefined()
    expect(grantLabel('shell:git commit')).toBe('以「git commit」开头的命令')
    setLanguage('en-US')
    expect(grantLabel('remember')).toBe('the remember tool')
  })
})
