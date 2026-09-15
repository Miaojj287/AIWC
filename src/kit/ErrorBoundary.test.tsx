// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetLanguageForTests, setLanguage } from '@/i18n'
import { ErrorBoundary } from './ErrorBoundary'

let broken: boolean
let mounts: number

function Fragile() {
  mounts++
  if (broken) throw new Error('render failed')
  return <p>内容正常</p>
}

beforeEach(() => {
  broken = false
  mounts = 0
  // React reports every caught render error on console.error; keep the test output readable.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  __resetLanguageForTests()
})

describe('ErrorBoundary', () => {
  it('shows the error state in place of a child that throws, leaving its siblings rendered', () => {
    broken = true
    render(
      <div>
        <p>旁边的列</p>
        <ErrorBoundary>
          <Fragile />
        </ErrorBoundary>
      </div>,
    )
    expect(screen.getByRole('alert').textContent).toContain('无法显示此内容')
    expect(screen.queryByText('内容正常')).toBeNull()
    expect(screen.getByText('旁边的列')).toBeTruthy()
  })

  it('remounts the children on retry and recovers once they render again', () => {
    broken = true
    render(
      <ErrorBoundary>
        <Fragile />
      </ErrorBoundary>,
    )
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(screen.getByRole('alert')).toBeTruthy()

    broken = false
    const before = mounts
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(screen.getByText('内容正常')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(mounts).toBeGreaterThan(before)
  })

  it('follows the UI language', () => {
    setLanguage('en-US')
    broken = true
    render(
      <ErrorBoundary>
        <Fragile />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert').textContent).toContain("Can't display this content")
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('renders a custom fallback instead of the error state when one is given', () => {
    broken = true
    render(
      <ErrorBoundary fallback={null}>
        <Fragile />
      </ErrorBoundary>,
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('内容正常')).toBeNull()
  })

  it('passes children through untouched while nothing throws', () => {
    render(
      <ErrorBoundary>
        <Fragile />
      </ErrorBoundary>,
    )
    expect(screen.getByText('内容正常')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
