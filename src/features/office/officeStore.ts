/**
 * Office connect sessions as the renderer sees them: pushed by main on 'office:session', hydrated once
 * from 'office:sessions' so a reloaded window still shows a flow that is waiting in the browser.
 * The agent card finds its session by tool call id; the settings dialog by session id.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import type { OfficeConnectSession, OfficePlatform } from '@aiwc/protocol'
import { getBridge } from '@/platform/bridge'

interface OfficeState {
  sessions: Record<string, OfficeConnectSession>
}

export const useOfficeStore = create<OfficeState>(() => ({ sessions: {} }))

export function upsertSession(session: OfficeConnectSession): void {
  useOfficeStore.setState((state) => {
    const previous = state.sessions[session.id]
    if (previous && previous.updatedAt > session.updatedAt) return state
    return { sessions: { ...state.sessions, [session.id]: session } }
  })
}

let subscription: Promise<void> | undefined

export function ensureOfficeSubscription(): Promise<void> {
  subscription ??= getBridge()
    .then(async (bridge) => {
      bridge.on('office:session', upsertSession)
      for (const session of await bridge.invoke('office:sessions', undefined)) upsertSession(session)
    })
    .catch(() => {
      subscription = undefined
    })
  return subscription
}

export const isActiveSession = (s: OfficeConnectSession | undefined): boolean =>
  s?.state === 'running' || s?.state === 'waiting'

function useSubscribed(): void {
  useEffect(() => {
    void ensureOfficeSubscription()
  }, [])
}

export function useOfficeSession(sessionId: string | undefined): OfficeConnectSession | undefined {
  useSubscribed()
  return useOfficeStore((s) => (sessionId ? s.sessions[sessionId] : undefined))
}

/**
 * The session a tool call drives: the one it started, or — when the call joined a flow already running
 * for that platform (started from settings) — the newest active one for the platform.
 */
export function useSessionForCall(
  callId: string,
  platform: OfficePlatform | undefined,
  running: boolean,
): OfficeConnectSession | undefined {
  useSubscribed()
  return useOfficeStore((s) => {
    let joined: OfficeConnectSession | undefined
    for (const session of Object.values(s.sessions)) {
      if (session.callId === callId) return session
      if (
        running &&
        platform &&
        session.platform === platform &&
        isActiveSession(session) &&
        (!joined || session.startedAt > joined.startedAt)
      )
        joined = session
    }
    return joined
  })
}

export function __resetOfficeStoreForTests(): void {
  subscription = undefined
  useOfficeStore.setState({ sessions: {} })
}
