/**
 * Skill folders as the renderer sees them (设置 › 技能, the task editor's parameter hints, the Agent's `/` menu):
 * hydrated once from 'skills:list', then replaced by every 'skills:changed' push. One subscription per window —
 * every feature reads this store instead of subscribing on its own.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { parseSlashCommand, skillMatchesCommand, type SkillEntry } from '@aiwc/protocol'
import { getBridge } from './bridge'

interface SkillsState {
  entries: SkillEntry[]
  status: 'idle' | 'loading' | 'ready' | 'error'
}

export const useSkillsStore = create<SkillsState>(() => ({ entries: [], status: 'idle' }))

let subscription: Promise<void> | undefined

/** Subscribe once per window; a failed first load can be retried (the subscription is dropped on failure). */
export function ensureSkills(): Promise<void> {
  subscription ??= getBridge()
    .then(async (bridge) => {
      useSkillsStore.setState({ status: 'loading' })
      bridge.on('skills:changed', ({ skills }) => useSkillsStore.setState({ entries: skills, status: 'ready' }))
      const entries = await bridge.invoke('skills:list', undefined)
      useSkillsStore.setState({ entries, status: 'ready' })
    })
    .catch(() => {
      subscription = undefined
      useSkillsStore.setState({ status: 'error' })
    })
  return subscription
}

/** Rescan the folders (a skill edited by hand) and refresh the store. */
export async function reloadSkills(): Promise<void> {
  if (!subscription) return ensureSkills()
  useSkillsStore.setState({ status: 'loading' })
  try {
    const bridge = await getBridge()
    useSkillsStore.setState({ entries: await bridge.invoke('skills:list', undefined), status: 'ready' })
  } catch {
    useSkillsStore.setState({ status: 'error' })
  }
}

/** The skill list (and its load state) for a component; starts the subscription on mount. */
export function useSkills(): SkillsState {
  useEffect(() => {
    void ensureSkills()
  }, [])
  const entries = useSkillsStore((s) => s.entries)
  const status = useSkillsStore((s) => s.status)
  return { entries, status }
}

/** Run `listener` after every change of the skill list (the Agent reloads its `/` menu). Returns the unsubscribe. */
export function onSkillsChanged(listener: () => void): () => void {
  void ensureSkills()
  return useSkillsStore.subscribe((state, prev) => {
    if (state.entries !== prev.entries) listener()
  })
}

/** The skill a prompt invokes with `/name …` (enabled or not), for hints next to a task prompt. */
export function skillForPrompt(entries: readonly SkillEntry[], prompt: string): SkillEntry | undefined {
  const slash = parseSlashCommand(prompt)
  if (!slash) return undefined
  return entries.find((s) => s.usable && skillMatchesCommand(s, slash.command))
}

/** `name=value` pairs written after a `/skill` command (values without spaces). */
export function skillArgValues(prompt: string): Record<string, string> {
  const args = parseSlashCommand(prompt)?.args ?? ''
  const out: Record<string, string> = {}
  for (const m of args.matchAll(/(?:^|\s)([^\s=]+)=(\S*)/g)) if (m[1]) out[m[1]] = m[2] ?? ''
  return out
}

/** Required parameters that have no `name=value` yet in the prompt. */
export function unfilledParams(skill: SkillEntry, prompt: string): SkillEntry['params'] {
  const values = skillArgValues(prompt)
  return skill.params.filter((p) => p.required && !values[p.name])
}

/** A task prompt that invokes the skill, with one `name=` slot per declared parameter (defaults filled in). */
export function skillPromptTemplate(skill: SkillEntry): string {
  const slots = skill.params.map((p) => `${p.name}=${p.default ?? ''}`)
  return [skill.command, ...slots].join(' ')
}

export function __resetSkillsForTests(): void {
  subscription = undefined
  useSkillsStore.setState({ entries: [], status: 'idle' })
}
