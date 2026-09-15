import { Component, Fragment, type ReactNode } from 'react'
import { useT } from '@/i18n'
import { cn } from './cn'
import { EmptyState } from './EmptyState'

export interface ErrorBoundaryProps {
  children: ReactNode
  /** Tighter error state for narrow columns (object list, Agent panel). */
  compact?: boolean
  /** Extra classes for the error state; it already fills its container's height. */
  className?: string
  /**
   * Replaces the error state for decorations too small for it (e.g. a status light in a 40px strip). `null` hides
   * the crashed subtree; it renders again when the boundary remounts.
   */
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
  /** Bumped on retry: the children are rendered under this key, so a retry remounts them with fresh state. */
  attempt: number
}

/**
 * ErrorBoundary — keeps one broken region from blanking the window (AGENTS.md §3.7). A render error in the
 * children shows the kit error state with a retry that remounts them. Wrap each tab host, list body and panel;
 * give the boundary a `key` when its content is swapped for different content, so an old error does not stick.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, attempt: 0 }

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  private readonly retry = (): void => {
    this.setState((state) => ({ error: null, attempt: state.attempt + 1 }))
  }

  override render(): ReactNode {
    const { children, compact = false, className, fallback } = this.props
    if (this.state.error) {
      if (fallback !== undefined) return fallback
      return <CaughtErrorState compact={compact} className={className} onRetry={this.retry} />
    }
    return <Fragment key={this.state.attempt}>{children}</Fragment>
  }
}

function CaughtErrorState({ compact, className, onRetry }: { compact: boolean; className?: string; onRetry(): void }) {
  const t = useT()
  return (
    <EmptyState
      variant="error"
      compact={compact}
      title={t('kit.errorBoundary.title')}
      description={t('kit.errorBoundary.description')}
      action={{ label: t('kit.errorBoundary.retry'), onClick: onRetry }}
      className={cn('h-full', className)}
    />
  )
}
