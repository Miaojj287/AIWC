/**
 * Agent tools for 飞书 / 钉钉 / 企业微信. Deterministic where it matters — connecting and pushing a
 * table are single calls with typed inputs. Everything else on these platforms goes through the
 * general `shell` tool and the vendor CLI (the office command classifier grades those calls):
 *
 *   office_status      read   connection state + recent pushes
 *   office_connect     write  install CLI if needed, browser authorization with live link/QR, waits
 *   office_push_table  send   create or append a table; the approval shows exactly what leaves
 *
 * None of them is mounted on WeChat bot threads: a remote contact must never be able to push local
 * chat data to an office platform.
 */
import { z } from 'zod'
import {
  defineTool,
  OFFICE_COLUMN_TYPES,
  OFFICE_PLATFORMS,
  type JsonValue,
  type OfficeConnectSession,
  type OfficePlatform,
  type ToolDefinition,
  type ToolResult,
} from '@aiwc/protocol'
import { OfficeError } from '../cli/runner'
import type { OfficeService } from '../service'

const PLATFORM = z.enum(OFFICE_PLATFORMS).describe('feishu=飞书，dingtalk=钉钉，wecom=企业微信')

const Cell = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()])

const StatusInput = z.object({
  refresh: z.boolean().optional().describe('忽略缓存重新检查'),
})

const ConnectInput = z.object({
  platform: PLATFORM,
  reauthorize: z.boolean().optional().describe('已连接也重新授权（换账号或授权过期时）'),
  domains: z
    .array(z.string().regex(/^[a-z]+$/))
    .max(20)
    .optional()
    .describe('仅飞书：额外申请的业务域，如 calendar、task'),
})

const PushInput = z.object({
  platform: PLATFORM,
  title: z.string().min(1).max(100).describe('表格名称；追加到已有表格时只用于记录'),
  sheetName: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe('数据表 / 子表名称。新建时默认「数据」；追加时指定写入哪张子表，默认第一张'),
  columns: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        type: z
          .enum(OFFICE_COLUMN_TYPES)
          .optional()
          .describe(
            'text 文本（默认）/ number 数字 / date 日期 / select 单选 / multi_select 多选 / checkbox 勾选 / url 链接',
          ),
      }),
    )
    .min(1)
    .max(50)
    .describe('列定义。第一列是主字段，总是按文本写入，放最能标识一行的内容'),
  rows: z
    .array(z.record(z.string(), Cell))
    .max(5000)
    .describe(
      '每行一个对象，键是列名。日期写 YYYY-MM-DD 或 YYYY-MM-DD HH:mm；多选写字符串数组；勾选写 true/false；空值省略',
    ),
  target: z
    .object({
      pushId: z.string().optional().describe('office_status 最近推送里的 pushId'),
      url: z.url().optional().describe('用户给出的已有表格链接'),
    })
    .optional()
    .describe('追加到已有表格；不传则新建。缺少的列会自动补上'),
})



const errorResult = (e: unknown, extra: Record<string, JsonValue> = {}): ToolResult => {
  const err = e instanceof OfficeError ? e : undefined
  return {
    content: {
      ok: false,
      code: err?.code ?? 'cli_error',
      error: e instanceof Error ? e.message : String(e),
      ...(err?.command ? { command: err.command } : {}),
      ...extra,
    },
    isError: true,
  }
}

const CONNECT_TIMEOUT_MS = 18 * 60_000

// `any` mirrors the other packages' tool factories: the registry holds heterogeneous input types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function officeTools(service: OfficeService): ToolDefinition<any, any>[] {
  const label = (p: OfficePlatform) => service.spec(p).label

  const status = defineTool<z.infer<typeof StatusInput>>({
    name: 'office_status',
    description:
      '查看飞书、钉钉、企业微信是否已连接（官方 CLI 是否安装、以谁的身份授权），以及最近推送过的表格（含 pushId，可用于追加）。',
    inputSchema: StatusInput,
    profiles: ['desktop-chat', 'subagent', 'cron'],
    risk: 'read',
    parallelSafe: true,
    timeoutMs: 90_000,
    summarize: () => '查看办公平台连接状态',
    async execute(input) {
      const [platforms, pushes] = await Promise.all([
        service.status({ refresh: input.refresh }),
        service.recentPushes(10),
      ])
      return {
        content: {
          platforms: platforms.map((s) => ({
            platform: s.platform,
            name: label(s.platform),
            connected: s.auth === 'authorized',
            auth: s.auth,
            cliInstalled: s.installed,
            ...(s.account
              ? {
                  account: [s.account.name, s.account.tenant, s.account.name ? undefined : s.account.id]
                    .filter(Boolean)
                    .join(' · '),
                }
              : {}),
            ...(s.detail ? { detail: s.detail } : {}),
          })),
          recentPushes: pushes.map((r) => ({
            pushId: r.id,
            platform: r.platform,
            title: r.title,
            url: r.url ?? null,
            rows: r.rows,
            mode: r.mode,
            pushedAt: new Date(r.createdAt).toISOString(),
          })),
        },
      }
    },
  })

  const connect = defineTool<z.infer<typeof ConnectInput>>({
    name: 'office_connect',
    description:
      '连接飞书 / 钉钉 / 企业微信。会按需安装官方 CLI，自动在浏览器打开授权页，并在对话里显示链接和二维码；用户在浏览器里完成后本工具自动继续，不需要用户回来回复。飞书首次连接有两步（创建应用、授权账号），钉钉和企业微信各一步。已连接时立即返回。调用前用一句话告诉用户接下来浏览器会打开授权页。',
    inputSchema: ConnectInput,
    profiles: ['desktop-chat'],
    risk: 'write',
    parallelSafe: false,
    timeoutMs: CONNECT_TIMEOUT_MS,
    maxOutputChars: 4000,
    summarize: (i) => `连接${label(i.platform)}（在浏览器中授权）`,
    async execute(input, ctx) {
      const { session, done } = service.connect({
        platform: input.platform,
        reauthorize: input.reauthorize,
        domains: input.domains,
        callId: String(ctx.callId),
      })
      const ownsSession = session.callId === String(ctx.callId)
      const onAbort = () => {
        if (ownsSession) service.cancel(session.id)
      }
      ctx.signal.addEventListener('abort', onAbort, { once: true })
      const unsubscribe = service.onSession((s) => {
        if (s.id === session.id) ctx.progress(progressText(s))
      })
      try {
        const final = await done
        return connectResult(final, label(input.platform))
      } finally {
        unsubscribe()
        ctx.signal.removeEventListener('abort', onAbort)
      }
    },
  })

  const pushTable = defineTool<z.infer<typeof PushInput>>({
    name: 'office_push_table',
    description:
      '把整理好的表格推送到飞书多维表格 / 钉钉 AI 表格 / 企业微信智能表格：默认新建一张表；传 target 则追加到已有表格。执行时用户会看到并确认要推送的全部内容。成功后返回表格链接，把链接给用户。平台未连接时先调用 office_connect。',
    inputSchema: PushInput,
    profiles: ['desktop-chat'],
    risk: 'send',
    parallelSafe: false,
    timeoutMs: 10 * 60_000,
    maxOutputChars: 4000,
    summarize: (i) => {
      const noun = service.spec(i.platform).tableNoun
      return i.target
        ? `追加 ${i.rows.length} 行到${label(i.platform)}${noun}`
        : `推送 ${i.rows.length} 行 × ${i.columns.length} 列到${label(i.platform)}${noun}「${i.title}」`
    },
    async execute(input, ctx) {
      try {
        const { record, warnings } = await service.pushTable(
          {
            platform: input.platform,
            title: input.title,
            sheetName: input.sheetName,
            columns: input.columns,
            rows: input.rows,
            target: input.target,
          },
          { signal: ctx.signal, progress: ctx.progress },
        )
        return {
          content: {
            ok: true,
            platform: record.platform,
            mode: record.mode,
            title: record.title,
            url: record.url ?? null,
            rows: record.rows,
            columns: record.columns,
            pushId: record.id,
            ...(warnings.length > 0 ? { warnings } : {}),
          },
        }
      } catch (e) {
        return errorResult(e, { platform: input.platform })
      }
    },
  })

  return [status, connect, pushTable]
}

function progressText(s: OfficeConnectSession): string {
  if (s.state === 'waiting') return s.link?.purpose === 'app' ? '等待在浏览器中创建应用' : '等待在浏览器中授权'
  const running = s.steps.find((st) => st.state === 'running')
  switch (running?.id) {
    case 'install':
      return '准备官方 CLI'
    case 'verify':
      return '验证授权'
    default:
      return '连接中'
  }
}

function connectResult(s: OfficeConnectSession, name: string): ToolResult {
  if (s.state === 'done') {
    const account = s.status?.account
    return {
      content: {
        connected: true,
        platform: s.platform,
        name,
        ...(account
          ? { account: [account.name, account.tenant].filter(Boolean).join(' · ') || account.id || null }
          : {}),
        cli: s.status?.cli.version ? `${s.status.cli.name} ${s.status.cli.version}` : (s.status?.cli.name ?? null),
      },
    }
  }
  return {
    content: {
      connected: false,
      platform: s.platform,
      code: s.error?.code ?? (s.state === 'cancelled' ? 'cancelled' : 'cli_error'),
      error: s.error?.message ?? (s.state === 'cancelled' ? '用户取消了连接' : '连接未完成'),
      ...(s.error?.command ? { command: s.error.command } : {}),
    },
    isError: true,
  }
}



