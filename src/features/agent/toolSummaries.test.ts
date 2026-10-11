import { afterEach, describe, expect, it } from 'vitest'
import type { JsonValue, ToolSummary } from '@aiwc/protocol'
import { __resetLanguageForTests, setLanguage, t } from '@/i18n'
import { toolCallLabel, WORDED_TOOLS } from './toolSummaries'

afterEach(() => __resetLanguageForTests())

const label = (toolName: string, input: JsonValue, extra: { display?: ToolSummary; summary?: string } = {}) =>
  toolCallLabel({ toolName, input, ...extra }, t)

/**
 * Every built-in tool (the names its package defines with defineTool) has a sentence of its own. A tool added to a
 * package without one still renders (generic wording), but should be added here and to FORMATTERS.
 */
const BUILT_IN_TOOLS = [
  // substrate
  'search_messages',
  'semantic_search',
  'list_contacts',
  'list_sessions',
  'list_groups',
  'group_members',
  'group_member_ranking',
  'chat_stats',
  'get_context',
  'get_timeline',
  'transcribe_voice_message',
  'query_sql',
  'search_media',
  // memory
  'remember',
  'recall',
  'forget',
  'list_memories',
  'get_relationship_profile',
  // gateway
  'send_message',
  'send_media',
  'draft_reply',
  // kernel
  'skill_view',
  'skill_manage',
  'skill_delete',
  'update_plan',
  'ask_user',
  'workflow_run',
  'delegate_analysis',
  // office, shell, tasks
  'office_status',
  'office_connect',
  'office_push_table',
  'shell',
  'task_create',
  'task_list',
  'task_update',
  'task_delete',
]

describe('toolCallLabel', () => {
  it('has a sentence for every built-in tool', () => {
    expect(BUILT_IN_TOOLS.filter((name) => !WORDED_TOOLS.includes(name))).toEqual([])
  })

  it('words rows from the input in the UI language, live and from history alike', () => {
    expect(label('search_messages', { query: '周报' })).toBe('搜索「周报」')
    expect(label('search_messages', { query: '周报', sessionIds: ['a', 'b'] })).toBe('在 2 个会话中搜索「周报」')
    expect(label('list_sessions', { limit: 20 })).toBe('列出最近 20 个会话')
    expect(label('search_media', { kind: 'video' })).toBe('查找视频')
    setLanguage('en-US')
    expect(label('search_messages', { query: '周报' })).toBe('Search for "周报"')
    expect(label('search_messages', { query: 'x', sessionIds: ['a'] })).toBe('Search 1 chat for "x"')
    expect(label('list_sessions', { limit: 1 })).toBe('List the latest chat')
    expect(label('search_media', { kind: 'video', query: 'cat' })).toBe('Find videos matching "cat"')
    expect(
      label('update_plan', {
        steps: [
          { title: 'a', status: 'done' },
          { title: 'b', status: 'todo' },
        ],
      }),
    ).toBe('Update plan (1/2 done)')
    expect(label('office_push_table', { platform: 'feishu', target: 'x', rows: [[1], [2]] })).toBe(
      'Append 2 rows to Feishu Base',
    )
  })

  it('reads several outgoing bubbles as one line, without the marker', () => {
    expect(label('send_message', { to: '小王', text: '在吗\n---wx-next---\n晚上吃饭' })).toBe(
      '发送消息给 小王：在吗 晚上吃饭',
    )
  })

  it('uses what the tool recorded when the input does not carry it (a task name)', () => {
    const display: ToolSummary = { code: 'task_update', params: { name: '周报提醒' } }
    expect(label('task_update', { id: 'tsk_1' }, { display })).toBe('修改定时任务：周报提醒')
    // an old rollout without it still reads as a sentence
    expect(label('task_update', { id: 'tsk_1' })).toBe('修改定时任务：tsk_1')
  })

  it('words MCP tools as server · tool, from the recorded labels or from the name', () => {
    const display: ToolSummary = { code: 'mcp', params: { server: 'GitHub', tool: 'search', args: '{"q":"x"}' } }
    expect(label('mcp__github__search', { q: 'x' }, { display })).toBe('GitHub · search {"q":"x"}')
    expect(label('mcp__github__search', { q: 'x' })).toBe('github · search x')
  })

  it('falls back to the kernel wording only in the Chinese UI, never leaking it into English', () => {
    expect(label('third_party_tool', { a: 1 }, { summary: '第三方工具' })).toBe('第三方工具')
    setLanguage('en-US')
    expect(label('third_party_tool', { a: 1 }, { summary: '第三方工具' })).toBe('third party tool 1')
    // a recorded input of an unexpected shape reads generically instead of throwing
    expect(label('get_context', { anchor: 'nope' })).toBe('get context nope')
  })
})
