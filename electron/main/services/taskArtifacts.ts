/**
 * The files a scheduled run produced, kept on its TaskRun so 最近运行 can open them: by path only (the content stays
 * in the workspace), de-duplicated, the newest last, capped so a chatty run cannot bloat runs.jsonl.
 */
import type { TaskRun, ToolArtifact } from '@aiwc/protocol'

export const MAX_RUN_ARTIFACTS = 10

export function runArtifacts(artifacts: readonly ToolArtifact[]): TaskRun['artifacts'] {
  const byPath = new Map<string, { title: string; path: string }>()
  for (const a of artifacts) {
    if (!a.path) continue
    byPath.delete(a.path)
    byPath.set(a.path, { title: a.title, path: a.path })
  }
  const files = [...byPath.values()].slice(-MAX_RUN_ARTIFACTS)
  return files.length ? files : undefined
}
