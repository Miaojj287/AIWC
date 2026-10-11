/** A search snippet with its matched words highlighted (the marks come from agent:searchThreads). */
import { splitSearchSnippet } from '@aiwc/protocol'

export function SnippetText({ snippet }: { snippet: string }) {
  return (
    <>
      {splitSearchSnippet(snippet).map((run, i) =>
        run.match ? (
          <mark key={i} className="rounded-sm bg-accent-30 px-px text-fg">
            {run.text}
          </mark>
        ) : (
          <span key={i}>{run.text}</span>
        ),
      )}
    </>
  )
}
