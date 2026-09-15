/** Isolated review fixture (dev server only); the production bridge never falls back to simulated data. */
import { createRoot } from 'react-dom/client'
import '@/styles/tailwind.css'
import { App } from '@/app/App'
import { createMockBridge } from '@/platform/mockBridge'
import { __setBridgeForTests } from '@/platform/bridge'
import { newRule } from '@/features/autoreply/ruleModel'
import { useShellStore } from '@/shell/shellStore'
import { useTabsStore } from '@/workspace/tabsStore'
const bridge = createMockBridge({ timeScale: 0.1, storage: null })
__setBridgeForTests(bridge)
await bridge.invoke('config:set', { onboarding: { completed: true } })
const sessions = await bridge.invoke('substrate:listSessions', { limit: 10, kind: 'dm' })
const session = sessions.items[0]!
await bridge.invoke('autoreply:saveRule', {
  ...newRule(session.id),
  source: 'ai',
  prompt: '用我平时的语气回消息，短句、口语。',
  historyCount: 50,
})
useTabsStore.getState().open({ kind: 'autoreply', objectId: session.id, title: '自动回复验收' })
useShellStore.setState({ railFunction: 'autoreply' })
createRoot(document.getElementById('root')!).render(<App />)
