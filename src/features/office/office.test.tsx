import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { OfficeConnectSession } from '@aiwc/protocol'
import { approvalNoteFor, toolCardFor } from '@/features/agent/toolCards'
import type { ApprovalRequest, ToolCallView } from '@/features/agent/model'
import { t } from '@/i18n'
import { TooltipProvider } from '@/kit'
import { register } from './index'
import { OfficeConnectPanel } from './OfficeConnectPanel'
import { __resetOfficeStoreForTests, upsertSession } from './officeStore'

const { invokeMock, openUrlMock } = vi.hoisted(() => ({ invokeMock: vi.fn(), openUrlMock: vi.fn() }))
vi.mock('@/platform/hooks', () => ({
  invoke: invokeMock,
  useBridgeEvent: () => {},
  useInvoke: () => ({ data: undefined, loading: false, reload: () => {} }),
}))
vi.mock('@/platform/openExternal', () => ({ openUrl: openUrlMock }))
vi.mock('@/platform/bridge', () => ({ getBridge: () => Promise.reject(new Error('no bridge in tests')) }))

const QR = 'data:image/png;base64,iVBORw0KGgo='

function session(patch: Partial<OfficeConnectSession>): OfficeConnectSession {
  return {
    id: 'ofc_1',
    platform: 'feishu',
    state: 'waiting',
    steps: [
      { id: 'install', state: 'done', detail: 'lark-cli 1.0.94' },
      { id: 'app', state: 'done' },
      { id: 'authorize', state: 'running' },
      { id: 'verify', state: 'pending' },
    ],
    link: {
      purpose: 'authorize',
      url: 'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=8XRB-M9MQ',
      qrDataUrl: QR,
      userCode: '8XRB-M9MQ',
      expiresAt: Date.now() + 9 * 60_000,
      opened: true,
    },
    callId: 'call_1',
    startedAt: 1,
    updatedAt: 2,
    ...patch,
  }
}

const wrap = (node: React.ReactNode) => render(<TooltipProvider>{node}</TooltipProvider>)

beforeEach(() => {
  invokeMock.mockReset()
  invokeMock.mockResolvedValue(true)
  openUrlMock.mockReset()
  __resetOfficeStoreForTests()
})
afterEach(cleanup)

it('shows the waiting link with its QR, code and expiry, and re-opens it through main', () => {
  wrap(<OfficeConnectPanel session={session({})} />)
  expect(screen.getByText(t('office.step.authorize'))).toBeTruthy()
  expect(screen.getByText('lark-cli 1.0.94')).toBeTruthy()
  expect(screen.getByText(t('office.connect.waitingAuthorize'))).toBeTruthy()
  expect(
    (screen.getByAltText(t('office.connect.scanHint', { platform: t('office.platform.feishu') })) as HTMLImageElement)
      .src,
  ).toBe(QR)
  expect(screen.getByText(t('office.connect.userCode', { code: '8XRB-M9MQ' }))).toBeTruthy()
  expect(screen.getByText(t('office.connect.expiresIn', { minutes: 9 }))).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: t('office.connect.openLink') }))
  expect(invokeMock).toHaveBeenCalledWith('office:openLink', { sessionId: 'ofc_1' })
  fireEvent.click(screen.getByRole('button', { name: t('office.connect.cancel') }))
  expect(invokeMock).toHaveBeenCalledWith('office:cancel', { sessionId: 'ofc_1' })
})

it('tells the user when the browser did not open, and uses the WeCom scan copy', () => {
  wrap(
    <OfficeConnectPanel
      session={session({
        platform: 'wecom',
        steps: [
          { id: 'install', state: 'done' },
          { id: 'authorize', state: 'running' },
          { id: 'verify', state: 'pending' },
        ],
        link: { purpose: 'authorize', url: 'https://work.weixin.qq.com/ai/qc/gen?scode=x', opened: false },
      })}
    />,
  )
  expect(screen.getByText(t('office.connect.notOpened'))).toBeTruthy()
  expect(screen.getByText(t('office.connect.waitingWecom'))).toBeTruthy()
  expect(screen.getByText(t('office.step.authorizeWecom'))).toBeTruthy()
})

it('shows the failure, the manual install command and a retry', () => {
  const onRetry = vi.fn()
  wrap(
    <OfficeConnectPanel
      onRetry={onRetry}
      session={session({
        state: 'failed',
        link: undefined,
        steps: [
          { id: 'install', state: 'failed' },
          { id: 'authorize', state: 'pending' },
          { id: 'verify', state: 'pending' },
        ],
        platform: 'dingtalk',
        error: { code: 'cli_missing', message: 'npm not found', command: 'npm install -g dingtalk-workspace-cli' },
      })}
    />,
  )
  expect(screen.getByText(t('office.connect.failed', { platform: t('office.platform.dingtalk') }))).toBeTruthy()
  expect(screen.getByText('npm not found')).toBeTruthy()
  expect(screen.getByText('npm install -g dingtalk-workspace-cli')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: t('office.connect.retry') }))
  expect(onRetry).toHaveBeenCalled()
})

it('registers cards for its tools: the connect card follows the session of its call', () => {
  register()
  const ConnectCard = toolCardFor('office_connect')!
  const call: ToolCallView = {
    callId: 'call_1' as ToolCallView['callId'],
    toolName: 'office_connect',
    summary: '',
    status: 'running',
    risk: 'write',
    input: { platform: 'feishu' },
    startedAt: 1,
  }
  wrap(<ConnectCard call={call} />)
  expect(screen.queryByText(t('office.connect.openLink'))).toBeNull()
  act(() => upsertSession(session({})))
  expect(screen.getByText(t('office.connect.openLink'))).toBeTruthy()
  act(() =>
    upsertSession(
      session({
        state: 'done',
        link: undefined,
        updatedAt: 3,
        status: {
          platform: 'feishu',
          installed: true,
          cli: { name: 'lark-cli' },
          auth: 'authorized',
          account: { name: '缪亦隽' },
          canDisconnect: true,
          checkedAt: 3,
        },
      }),
    ),
  )
  expect(
    screen.getByText(t('office.connect.doneAs', { platform: t('office.platform.feishu'), account: '缪亦隽' })),
  ).toBeTruthy()
})

it('the push card opens only links on the platform’s own hosts', () => {
  register()
  const PushCard = toolCardFor('office_push_table')!
  const base: ToolCallView = {
    callId: 'c2' as ToolCallView['callId'],
    toolName: 'office_push_table',
    summary: '',
    status: 'done',
    risk: 'send',
    input: {},
    startedAt: 1,
  }
  const { rerender } = wrap(
    <PushCard
      call={{
        ...base,
        output: {
          ok: true,
          platform: 'feishu',
          mode: 'create',
          title: '客户问题汇总',
          url: 'https://t.feishu.cn/base/bas1?table=tbl1',
          rows: 42,
        },
      }}
    />,
  )
  expect(screen.getByText('客户问题汇总')).toBeTruthy()
  expect(
    screen.getByText(
      t('office.push.created', { rows: 42, platform: t('office.platform.feishu'), noun: t('office.tableNoun.feishu') }),
    ),
  ).toBeTruthy()
  fireEvent.click(
    screen.getByRole('button', { name: t('office.push.open', { platform: t('office.platform.feishu') }) }),
  )
  expect(openUrlMock).toHaveBeenCalledWith('https://t.feishu.cn/base/bas1?table=tbl1')
  rerender(
    <TooltipProvider>
      <PushCard
        call={{
          ...base,
          output: {
            ok: true,
            platform: 'feishu',
            mode: 'create',
            title: 'x',
            url: 'https://evil.example.com/base/1',
            rows: 1,
          },
        }}
      />
    </TooltipProvider>,
  )
  expect(
    screen.queryByRole('button', { name: t('office.push.open', { platform: t('office.platform.feishu') }) }),
  ).toBeNull()
})

it('approval notes say which platform account the data goes to', () => {
  register()
  const request = {
    approvalId: 'a1',
    callId: 'c1',
    turnId: 'u1',
    toolName: 'office_push_table',
    summary: '',
    input: { platform: 'dingtalk' },
    risk: 'send',
    canAllowAlways: false,
  } as unknown as ApprovalRequest
  expect(approvalNoteFor(request, t)).toBe(t('office.approval.push', { platform: t('office.platform.dingtalk') }))
  expect(approvalNoteFor({ ...request, toolName: 'send_message' }, t)).toBeUndefined()
})
