/**
 * AI 接入 — Agent model vendors (Figma 164:4211 adapted: the 配置自定义模型 dialog becomes this settings
 * page, so the vendor rail + provider panel live in a card), 默认模型, and speech-to-text (unchanged).
 */
import { Cloud, HardDrive, Unplug } from "lucide-react";
import { useContext, useEffect, useState } from "react";
import type {
  ModelEntry,
  ModelSelection,
  ProviderConfig,
} from "@aiwc/protocol";
import {
  Badge,
  Card,
  DangerDialog,
  InlineHint,
  SegmentedControl,
  Select,
  cn,
  toast,
} from "@/kit";
import { useConfig } from "@/platform/configStore";
import { invoke } from "@/platform/hooks";
import {
  isLocalKind,
  modelEntryFromId,
  modelOptions,
  modelValue,
  newProvider,
  parseModelValue,
  patchModel,
  providerForVendor,
  removeModel,
  resolveDefaultModel,
  upsertProvider,
} from "../aiModel";
import { errorMessage, saveConfig } from "../hooks";
import {
  HighlightContext,
  PagePlaceholder,
  SRow,
  Section,
  rowDomId,
} from "../pageKit";
import { VENDORS, vendorById } from "../vendors";
import { AddModelDialog } from "./ai/AddModelDialog";
import {
  ConnectProviderDialog,
  type ConnectMode,
} from "./ai/ConnectProviderDialog";
import { useModelSync } from "./ai/useModelSync";
import { ProviderPanel } from "./ai/ProviderPanel";
import { ProviderRail, type RailSelection } from "./ai/ProviderRail";
import { ModelForm } from "./ModelForm";
import { SttLocalList } from "./SttLocalList";

const STT_ONLINE_ID = "stt-online";

const PRIVACY_AGENT =
  "在线模型：对话内容与被引用的聊天记录会发送给该服务商；Ollama 等本地模型不出本机。";
const PRIVACY_TERMS =
  "接入即代表你自主选择使用该模型，并自行承担由此产生的数据安全与合规风险。API Key 仅用于调用你所选厂商的服务，只保存在本机钥匙串。";
const PRIVACY_STT =
  "在线转写：语音文件会上传到该服务商；本地模式全程在本机完成。";

const CARD_HIGHLIGHT_IDS = [
  "ai.providers",
  "ai.apiKey",
  "ai.models",
  "ai.status",
];

type DialogState =
  | {
      kind: "connect";
      mode: ConnectMode;
      vendorId?: string;
      providerId?: string;
    }
  | { kind: "add-model"; providerId: string }
  | { kind: "disconnect"; providerId: string }
  | undefined;

export function AiPage() {
  const ai = useConfig((c) => c.ai);
  const highlight = useContext(HighlightContext);
  const [selection, setSelection] = useState<RailSelection>({
    kind: "vendor",
    id: VENDORS[0]?.id ?? "deepseek",
  });
  const [dialog, setDialog] = useState<DialogState>(undefined);
  const [testingId, setTestingId] = useState<string | null>(null);

  // First paint: land on the vendor of the default model (or the first configured one).
  useEffect(() => {
    if (!ai) return;
    const preferred =
      ai.providers.find((p) => p.id === ai.defaultModel?.providerId) ??
      ai.providers[0];
    if (preferred)
      setSelection(
        preferred.vendor
          ? { kind: "vendor", id: preferred.vendor }
          : { kind: "custom", id: preferred.id },
      );
  }, [ai === undefined]);

  // Fall back when the selected custom provider is removed.
  useEffect(() => {
    if (!ai || selection.kind !== "custom") return;
    if (!ai.providers.some((p) => p.id === selection.id))
      setSelection({ kind: "vendor", id: VENDORS[0]?.id ?? "deepseek" });
  }, [ai, selection]);

  const selectedProvider = selection.kind === "vendor"
    ? ai?.providers.find(p => p.vendor === selection.id)
    : selection.kind === "custom" ? ai?.providers.find(p => p.id === selection.id) : undefined;
  const modelSync = useModelSync(selectedProvider);
  if (!ai) return <PagePlaceholder rows={5} />;

  const providers = ai.providers;
  const vendor =
    selection.kind === "vendor" ? vendorById(selection.id) : undefined;
  const provider =
    selection.kind === "vendor"
      ? providerForVendor(providers, selection.id)
      : selection.kind === "custom"
        ? providers.find((p) => p.id === selection.id)
        : undefined;

  const persist = async (
    list: ProviderConfig[],
    okText?: string,
  ): Promise<boolean> => {
    const ok = await saveConfig({
      ai: {
        providers: list,
        defaultModel: resolveDefaultModel(list, ai.defaultModel),
      },
    });
    if (ok && okText) toast.success(okText);
    return ok;
  };
  const updateProvider = (p: ProviderConfig, okText?: string) =>
    persist(upsertProvider(providers, p), okText);

  const runTest = async (p: ProviderConfig) => {
    const modelId =
      p.models.find((m) => m.enabled !== false)?.modelId ??
      p.models[0]?.modelId;
    if (!modelId) return;
    setTestingId(p.id);
    try {
      const res = await invoke("ai:testModel", { provider: p, modelId });
      const next: ProviderConfig = res.ok
        ? {
            ...patchModel(p, modelId, {
              supportsTools: res.supportsTools ?? true,
            }),
            lastTest: { ok: true, at: Date.now(), latencyMs: res.latencyMs },
          }
        : {
            ...p,
            lastTest: {
              ok: false,
              at: Date.now(),
              message: res.error?.message ?? "连接失败",
            },
          };
      await updateProvider(next);
      if (res.ok)
        toast.success(`「${p.label}」已连接`, {
          detail:
            res.latencyMs !== undefined
              ? `延迟 ${Math.round(res.latencyMs)} ms`
              : undefined,
        });
      else
        toast.error(`「${p.label}」连接失败`, { detail: res.error?.message });
    } catch (e) {
      await updateProvider({
        ...p,
        lastTest: { ok: false, at: Date.now(), message: errorMessage(e) },
      });
      toast.error(`「${p.label}」连接失败`, { detail: errorMessage(e) });
    } finally {
      setTestingId(null);
    }
  };

  const disconnect = async (p: ProviderConfig) => {
    const list = providers.filter((x) => x.id !== p.id);
    if (p.apiKeyRef)
      await invoke("secret:delete", { ref: p.apiKeyRef }).catch(
        () => undefined,
      );
    if (await persist(list, `已断开「${p.label}」`)) setDialog(undefined);
  };

  const defaultOptions = modelOptions(providers).map((o) => ({
    value: o.value,
    label: o.label,
    description: o.description,
    badge: o.local ? <Badge tone="ok">本地</Badge> : undefined,
  }));
  const dialogProvider =
    dialog && "providerId" in dialog && dialog.providerId
      ? providers.find((p) => p.id === dialog.providerId)
      : undefined;
  const cardHighlighted =
    highlight !== undefined && CARD_HIGHLIGHT_IDS.includes(highlight);

  const stt = ai.stt;
  const sttOnline =
    stt.online ?? newProvider("openai-compatible", STT_ONLINE_ID);

  return (
    <>
      <Section
        title="Agent 模型"
        aside={`${providers.length} 个已接入 · ${modelOptions(providers).length} 个模型可用`}
      >
        {/* The container query lives on a wrapper: an element cannot query its own size. */}
        <div className="@container">
          <Card
            variant="rows"
            id={rowDomId("ai.providers")}
            data-setting-row="ai.providers"
            data-highlighted={cardHighlighted || undefined}
            className={cn(
              "flex min-h-[320px] flex-col overflow-hidden transition-colors duration-(--dur-base) @min-[560px]:flex-row",
              cardHighlighted && "ring-1 ring-inset ring-accent/50",
            )}
          >
            <ProviderRail
              providers={providers}
              selection={selection}
              onSelect={setSelection}
            />
            {selection.kind === "new-custom" ? (
              <ProviderPanel
                vendor={undefined}
                provider={undefined}
                onConnect={() => setDialog({ kind: "connect", mode: "custom" })}
                onEditKey={() => undefined}
                onTest={() => undefined}
                onDisconnect={() => undefined}
                onToggleModel={() => undefined}
                onPatchModel={() => undefined}
                onRemoveModel={() => undefined}
                onAddModel={() => undefined}
              />
            ) : (
              <ProviderPanel
                vendor={vendor}
                provider={provider}
                {...modelSync}
                testing={provider !== undefined && testingId === provider.id}
                onConnect={() =>
                  setDialog({
                    kind: "connect",
                    mode: vendor ? "connect" : "custom",
                    vendorId: vendor?.id,
                    providerId: provider?.id,
                  })
                }
                onEditKey={() =>
                  provider &&
                  setDialog({
                    kind: "connect",
                    mode: "key",
                    vendorId: vendor?.id,
                    providerId: provider.id,
                  })
                }
                onEdit={
                  provider && !vendor
                    ? () =>
                        setDialog({
                          kind: "connect",
                          mode: "custom",
                          providerId: provider.id,
                        })
                    : undefined
                }
                onTest={() => provider && void runTest(provider)}
                onDisconnect={() =>
                  provider &&
                  setDialog({ kind: "disconnect", providerId: provider.id })
                }
                onToggleModel={(modelId, enabled) =>
                  provider &&
                  void updateProvider(
                    patchModel(provider, modelId, { enabled }),
                  )
                }
                onPatchModel={(modelId, patch) =>
                  provider &&
                  void updateProvider(patchModel(provider, modelId, patch))
                }
                onRemoveModel={(modelId) =>
                  provider &&
                  void updateProvider(
                    removeModel(provider, modelId),
                    "已移除模型",
                  )
                }
                onAddModel={() =>
                  provider &&
                  setDialog({ kind: "add-model", providerId: provider.id })
                }
              />
            )}
          </Card>
        </div>
        <Card variant="rows">
          <SRow
            id="ai.defaultModel"
            title="默认模型"
            description="新建 Agent 会话时使用的模型；每个会话可在对话框底部临时切换"
            htmlFor="ai-default-model"
          >
            <Select
              id="ai-default-model"
              aria-label="默认模型"
              options={defaultOptions}
              value={ai.defaultModel ? modelValue(ai.defaultModel) : null}
              placeholder={
                defaultOptions.length ? "选择默认模型" : "先接入一个厂商"
              }
              disabled={defaultOptions.length === 0}
              searchable={defaultOptions.length > 6}
              searchPlaceholder="搜索模型…"
              onValueChange={(v) => {
                const sel: ModelSelection | undefined = parseModelValue(v);
                if (sel) void saveConfig({ ai: { defaultModel: sel } });
              }}
              align="end"
              className="min-w-[180px] max-w-[260px]"
            />
          </SRow>
        </Card>
        <InlineHint kind="info">{PRIVACY_AGENT}</InlineHint>
        <InlineHint kind="warning">{PRIVACY_TERMS}</InlineHint>
      </Section>

      <Section title="语音转文字">
        <Card variant="rows">
          <SRow
            id="ai.sttMode"
            title="转写模式"
            description="本地模式不上传音频；在线模式通过兼容接口转写"
          >
            <SegmentedControl
              aria-label="转写模式"
              value={stt.mode}
              options={[
                { value: "local", label: "本地", icon: HardDrive },
                { value: "online", label: "在线", icon: Cloud },
              ]}
              onValueChange={(mode) =>
                void saveConfig({ ai: { stt: { ...stt, mode } } })
              }
            />
          </SRow>
          {stt.mode === "local" ? (
            <SttLocalList />
          ) : (
            // The page's single primary is the 接入 button in the vendor panel (only shown for an unconnected
            // vendor); the transcription form saves with an outline button (CLAUDE.md §2.2 「每屏最多一个 primary」).
            <ModelForm
              key={sttOnline.id}
              provider={sttOnline}
              purpose="stt"
              primaryTone="outline"
              rowIds={{
                kind: "ai.sttOnline",
                baseUrl: "ai.sttOnline.url",
                apiKey: "ai.sttOnline.key",
                modelId: "ai.sttOnline.model",
                status: "ai.sttOnline.status",
              }}
              onSave={async (next) => {
                if (
                  !(await saveConfig({ ai: { stt: { ...stt, online: next } } }))
                )
                  throw new Error("config:set 失败");
              }}
            />
          )}
        </Card>
        <InlineHint kind="info">
          {stt.mode === "local"
            ? "本地模式：音频在本机转写，不发送到任何服务商。"
            : PRIVACY_STT}
        </InlineHint>
      </Section>

      <ConnectProviderDialog
        open={dialog?.kind === "connect"}
        onOpenChange={(o) => !o && setDialog(undefined)}
        mode={dialog?.kind === "connect" ? dialog.mode : "connect"}
        vendor={
          dialog?.kind === "connect" ? vendorById(dialog.vendorId) : undefined
        }
        provider={dialog?.kind === "connect" ? dialogProvider : undefined}
        onSave={async (next) => {
          const isNew = !providers.some((p) => p.id === next.id);
          if (
            !(await updateProvider(
              next,
              isNew ? `已接入「${next.label}」` : `「${next.label}」已更新`,
            ))
          )
            throw new Error("config:set 失败");
          setSelection(
            next.vendor
              ? { kind: "vendor", id: next.vendor }
              : { kind: "custom", id: next.id },
          );
        }}
      />
      {dialogProvider && dialog?.kind === "add-model" ? (
        <AddModelDialog
          open
          onOpenChange={(o) => !o && setDialog(undefined)}
          provider={dialogProvider}
          onAdd={async (modelId) => {
            const entry: ModelEntry = modelEntryFromId(
              modelId,
              undefined,
            );
            await updateProvider(
              { ...dialogProvider, ignoredModelIds: dialogProvider.ignoredModelIds?.filter(id => id !== modelId), models: [...dialogProvider.models.filter(m => m.modelId !== modelId), entry] },
              `已添加 ${modelId}`,
            );
          }}
        />
      ) : null}
      <DangerDialog
        open={dialog?.kind === "disconnect"}
        onOpenChange={(o) => !o && setDialog(undefined)}
        title={`断开「${dialogProvider?.label ?? ""}」？`}
        description={
          dialogProvider && isLocalKind(dialogProvider.kind)
            ? "它的模型将从列表中移除；引用它们的会话会回退到默认模型。"
            : "它的模型将不可用，钥匙串中的 API Key 也会被删除；引用它们的会话会回退到默认模型。"
        }
        confirmLabel="断开"
        icon={Unplug}
        onConfirm={async () => {
          if (dialogProvider) await disconnect(dialogProvider);
        }}
      />
    </>
  );
}
