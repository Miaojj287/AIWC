/**
 * The composer's three ways in for attachments — paste (screenshots, copied files, a long text), drop onto the card and
 * the ＋ menu's file picker — plus the inline problem line. The composer owns the attachments through
 * `onChange`; this hook only reads files and applies the limits (attachments.ts).
 */
import { useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react'
import { checkAttachments, isLongPaste, type DraftAttachment } from '@aiwc/protocol'
import { useT } from '@/i18n'
import { addFiles, attachmentProblemText, pastedTextAttachment, type AttachmentProblem } from './attachments'

export interface AttachmentInput {
  /** Inline problem sentence (limits, unreadable file) until the next successful add or edit. */
  error: string | undefined
  clearError: () => void
  onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void
  /** Spread on the drop target. */
  dropProps: {
    onDragEnter: (e: DragEvent<HTMLElement>) => void
    onDragOver: (e: DragEvent<HTMLElement>) => void
    onDragLeave: (e: DragEvent<HTMLElement>) => void
    onDrop: (e: DragEvent<HTMLElement>) => void
  }
  /** A file is being dragged over the target (highlight it). */
  dragging: boolean
  pickFiles: () => void
  /** The hidden file input; render it once inside the composer. */
  fileInput: ReactNode
}

const hasFiles = (e: DragEvent<HTMLElement>): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files')

export function useAttachmentInput(
  attachments: readonly DraftAttachment[] | undefined,
  onChange: ((list: DraftAttachment[]) => void) | undefined,
): AttachmentInput | undefined {
  const t = useT()
  const [problem, setProblem] = useState<AttachmentProblem | undefined>(undefined)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Reads are async: the latest list, so two quick pastes do not overwrite each other.
  const latest = useRef(attachments ?? [])
  useLayoutEffect(() => {
    latest.current = attachments ?? []
  }, [attachments])

  if (!onChange) return undefined

  const add = async (files: File[]) => {
    if (files.length === 0) return
    const result = await addFiles(latest.current, files)
    setProblem(result.problem)
    if (result.attachments.length !== latest.current.length) {
      latest.current = result.attachments
      onChange(result.attachments)
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? [])
    if (files.length > 0) {
      e.preventDefault()
      void add(files)
      return
    }
    const text = e.clipboardData?.getData('text/plain') ?? ''
    if (!isLongPaste(text)) return
    e.preventDefault()
    const pastedCount = latest.current.filter((a) => a.pasted).length
    const next = [
      ...latest.current,
      pastedTextAttachment(text, t('agent.attachments.pastedName', { n: pastedCount + 1 })),
    ]
    // A pasted text attachment goes through the same limits as files.
    const violation = checkAttachments(next.map((a) => a.part))
    setProblem(violation)
    if (violation) return
    latest.current = next
    onChange(next)
  }

  return {
    error: problem ? attachmentProblemText(problem) : undefined,
    clearError: () => setProblem(undefined),
    onPaste,
    dragging,
    dropProps: {
      onDragEnter: (e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setDragging(true)
      },
      onDragOver: (e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      },
      onDragLeave: (e) => {
        // Leaving for a child element is not leaving the card.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        setDragging(false)
      },
      onDrop: (e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setDragging(false)
        void add(Array.from(e.dataTransfer.files))
      },
    },
    pickFiles: () => inputRef.current?.click(),
    fileInput: (
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        aria-hidden
        tabIndex={-1}
        data-testid="composer-file-input"
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? [])
          e.currentTarget.value = ''
          void add(files)
        }}
      />
    ),
  }
}
