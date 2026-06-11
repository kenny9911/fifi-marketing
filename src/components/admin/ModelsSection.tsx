"use client";

import { useRef, useState } from "react";
import { Tip } from "@/components/shared/Tip";
import { api } from "@/lib/client-api";
import type { ModelDto } from "@/lib/api-types";
import { describeError, fmtTime, pluckArray } from "./types";
import {
  EmptyHint,
  InkToggle,
  LoadingRow,
  SectionHead,
  inkBtnCls,
  selectCls,
  useToast,
} from "./ui";

const PROVIDER_STYLE: Record<ModelDto["provider"], { bg: string; fg: string }> = {
  openai: { bg: "#0FA36B", fg: "#FFFDF7" },
  openrouter: { bg: "#2849F4", fg: "#FFFDF7" },
  moonshot: { bg: "#FFC53D", fg: "#17130C" },
  minimax: { bg: "#FF7AB6", fg: "#17130C" },
};

const KIND_LABEL: Record<ModelDto["kind"], string> = {
  text: "文本",
  multimodal: "多模态",
  image: "图像",
};

const PROVIDERS: ModelDto["provider"][] = ["openai", "moonshot", "minimax", "openrouter"];
const KINDS: ModelDto["kind"][] = ["text", "multimodal", "image"];

interface NewModelForm {
  id: string;
  provider: ModelDto["provider"];
  kind: ModelDto["kind"];
  inputCostPerM: string;
  outputCostPerM: string;
}

const EMPTY_FORM: NewModelForm = {
  id: "",
  provider: "openrouter",
  kind: "text",
  inputCostPerM: "",
  outputCostPerM: "",
};

/**
 * 模型 MODELS — registry table with enable toggles, a whole-registry
 * validation pass with per-row result flashes (req 16: model ids are always
 * verified, never blind-trusted), and an inline add-model row.
 */
export function ModelsSection({
  models,
  loading,
  onRefresh,
}: {
  models: ModelDto[];
  loading: boolean;
  onRefresh: () => Promise<void>;
}) {
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [flash, setFlash] = useState<Record<string, "ok" | "bad">>({});
  const flashTimer = useRef<number | null>(null);
  const [form, setForm] = useState<NewModelForm>(EMPTY_FORM);
  const [adding, setAdding] = useState(false);

  const upsert = async (model: ModelDto, patch: Partial<ModelDto>) => {
    setBusyId(model.id);
    try {
      await api.post<unknown>("/api/admin/models", {
        id: model.id,
        provider: model.provider,
        kind: model.kind,
        inputCostPerM: model.inputCostPerM,
        outputCostPerM: model.outputCostPerM,
        enabled: model.enabled,
        ...patch,
      });
      await onRefresh();
      toast("模型已更新");
    } catch (err) {
      toast(describeError(err), "err");
    } finally {
      setBusyId(null);
    }
  };

  const validateAll = async () => {
    setValidating(true);
    try {
      const res = await api.post<unknown>("/api/admin/models/validate");
      const results = pluckArray<ModelDto & { checkedValid?: boolean }>(res, "models");
      const next: Record<string, "ok" | "bad"> = {};
      let ok = 0;
      let bad = 0;
      for (const m of results) {
        const passed = m.checkedValid ?? m.valid === true;
        next[m.id] = passed ? "ok" : "bad";
        if (passed) ok += 1;
        else bad += 1;
      }
      setFlash(next);
      if (flashTimer.current != null) window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlash({}), 2600);
      await onRefresh();
      toast(`校验完成：${ok} 个有效${bad > 0 ? ` / ${bad} 个无效` : ""}`, bad > 0 ? "err" : "ok");
    } catch (err) {
      toast(describeError(err), "err");
    } finally {
      setValidating(false);
    }
  };

  const addModel = async () => {
    const id = form.id.trim();
    if (!id) {
      toast("请填写模型 ID（如 vendor/model-name）", "err");
      return;
    }
    setAdding(true);
    try {
      await api.post<unknown>("/api/admin/models", {
        id,
        provider: form.provider,
        kind: form.kind,
        inputCostPerM: Number(form.inputCostPerM) || 0,
        outputCostPerM: Number(form.outputCostPerM) || 0,
        enabled: true,
      });
      setForm(EMPTY_FORM);
      await onRefresh();
      toast(`已加入注册表：${id}，建议立即校验`);
    } catch (err) {
      toast(describeError(err), "err");
    } finally {
      setAdding(false);
    }
  };

  return (
    <section className="flex flex-col gap-5">
      <SectionHead
        title="模型注册表"
        en="MODEL REGISTRY"
        desc="所有可用的 LLM / 图像模型与单价（美元 / 百万 token）。模型 ID 在调用前都会经过校验，绝不盲发。"
      >
        <Tip tip="逐一向各服务商核对模型 ID 是否真实可用；mock 模式下仅核对注册表本身">
          <button
            type="button"
            disabled={validating || loading}
            onClick={() => void validateAll()}
            className={inkBtnCls}
          >
            {validating ? "校验中…" : "⟳ 校验全部模型"}
          </button>
        </Tip>
      </SectionHead>

      {loading ? (
        <LoadingRow label="正在读取模型注册表…" />
      ) : models.length === 0 ? (
        <EmptyHint
          title="注册表是空的"
          next="用下方「新增模型」表单登记第一个模型，或运行 npm run seed 写入默认价目表。"
        />
      ) : (
        <div className="overflow-hidden rounded-[18px] border-2 border-ink bg-paper shadow-[6px_6px_0_#2849F4]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse text-left">
              <thead>
                <tr className="border-b-2 border-ink bg-cream font-grotesk text-[11px] font-bold tracking-[2px] text-stone">
                  <th className="px-5 py-3">MODEL ID</th>
                  <th className="px-3 py-3">服务商</th>
                  <th className="px-3 py-3">类型</th>
                  <th className="px-3 py-3 text-right">$IN /M</th>
                  <th className="px-3 py-3 text-right">$OUT /M</th>
                  <th className="px-3 py-3">启用</th>
                  <th className="px-3 py-3">有效</th>
                  <th className="px-5 py-3">最近校验</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => {
                  const style = PROVIDER_STYLE[m.provider];
                  const f = flash[m.id];
                  return (
                    <tr
                      key={m.id}
                      className={`border-b border-tan-light transition-colors duration-300 last:border-b-0 ${
                        f === "ok" ? "bg-jade/15" : f === "bad" ? "bg-poppy/15" : ""
                      } ${m.enabled ? "" : "opacity-55"}`}
                    >
                      <td className="px-5 py-3 font-mono text-[12px]">{m.id}</td>
                      <td className="px-3 py-3">
                        <span
                          className="inline-block rounded-full border-[1.5px] border-ink px-2.5 py-[2px] font-grotesk text-[10.5px] font-bold tracking-[1px]"
                          style={{ background: style.bg, color: style.fg }}
                        >
                          {m.provider.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-[12.5px] font-bold text-soot">
                        {KIND_LABEL[m.kind]}
                      </td>
                      <td className="px-3 py-3 text-right font-archivo text-[12.5px]">
                        ${m.inputCostPerM}
                      </td>
                      <td className="px-3 py-3 text-right font-archivo text-[12.5px]">
                        ${m.outputCostPerM}
                      </td>
                      <td className="px-3 py-3">
                        <InkToggle
                          on={m.enabled}
                          busy={busyId === m.id}
                          label={m.enabled ? `停用 ${m.id}（智能体下拉中将不再出现）` : `启用 ${m.id}`}
                          onChange={(next) => void upsert(m, { enabled: next })}
                        />
                      </td>
                      <td className="px-3 py-3">
                        {m.valid === true ? (
                          <span title="已通过服务商校验" className="font-bold text-jade">
                            ✓
                          </span>
                        ) : m.valid === false ? (
                          <span title="服务商返回该 ID 无效" className="font-bold text-poppy">
                            ✗
                          </span>
                        ) : (
                          <span title="尚未校验过" className="font-bold text-stone">
                            ?
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 font-mono text-[11px] text-stone">
                        {fmtTime(m.lastValidatedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* inline add-model row */}
          <div className="flex flex-wrap items-center gap-2.5 border-t-2 border-ink bg-cream px-5 py-3.5">
            <span className="font-grotesk text-[11px] font-bold tracking-[2px] text-stone">
              新增模型 ADD
            </span>
            <input
              value={form.id}
              onChange={(e) => setForm((p) => ({ ...p, id: e.target.value }))}
              title="规范模型 ID，OpenRouter 风格，如 deepseek/deepseek-v4-pro"
              placeholder="vendor/model-id"
              className="w-[220px] rounded-lg border-[1.5px] border-ink bg-paper px-2.5 py-1.5 font-mono text-[12px] outline-none focus:bg-cream"
            />
            <select
              value={form.provider}
              title="直连服务商"
              onChange={(e) =>
                setForm((p) => ({ ...p, provider: e.target.value as ModelDto["provider"] }))
              }
              className={selectCls}
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select
              value={form.kind}
              title="模型能力类型"
              onChange={(e) => setForm((p) => ({ ...p, kind: e.target.value as ModelDto["kind"] }))}
              className={selectCls}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <input
              value={form.inputCostPerM}
              onChange={(e) => setForm((p) => ({ ...p, inputCostPerM: e.target.value }))}
              title="输入单价：美元 / 百万 token"
              placeholder="$in /M"
              inputMode="decimal"
              className="w-[84px] rounded-lg border-[1.5px] border-ink bg-paper px-2.5 py-1.5 text-right font-archivo text-[12px] outline-none focus:bg-cream"
            />
            <input
              value={form.outputCostPerM}
              onChange={(e) => setForm((p) => ({ ...p, outputCostPerM: e.target.value }))}
              title="输出单价：美元 / 百万 token"
              placeholder="$out /M"
              inputMode="decimal"
              className="w-[84px] rounded-lg border-[1.5px] border-ink bg-paper px-2.5 py-1.5 text-right font-archivo text-[12px] outline-none focus:bg-cream"
            />
            <Tip tip="登记到注册表并默认启用；记得点「校验全部模型」确认 ID 真实存在">
              <button
                type="button"
                disabled={adding}
                onClick={() => void addModel()}
                className={inkBtnCls}
              >
                {adding ? "登记中…" : "+ 登记"}
              </button>
            </Tip>
          </div>
        </div>
      )}
    </section>
  );
}
