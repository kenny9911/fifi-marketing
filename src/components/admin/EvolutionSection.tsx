"use client";

import { useCallback, useEffect, useState } from "react";
import { Tip } from "@/components/shared/Tip";
import { api } from "@/lib/client-api";
import type { AgentDto, EvolutionRunDto, PromptVersionDto } from "@/lib/api-types";
import { MarkdownLite } from "./MarkdownLite";
import { describeError, fmtTime, pluckArray, pluckOne } from "./types";
import {
  EmptyHint,
  LoadingRow,
  SectionHead,
  inkBtnCls,
  paperBtnCls,
  selectCls,
  useToast,
} from "./ui";

const WINDOW_OPTIONS = [7, 14, 30];

/**
 * 自进化 EVOLUTION (req 10) — trigger a reflection run over a recent window,
 * read the improvement report, and review the prompt proposals it produced
 * (proposals stay `proposed` until activated in the prompt drawer).
 */
export function EvolutionSection({
  agents,
  onOpenPrompts,
}: {
  agents: AgentDto[];
  onOpenPrompts: (agentId: string) => void;
}) {
  const toast = useToast();
  const [runs, setRuns] = useState<EvolutionRunDto[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState(14);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<unknown>("/api/admin/evolve");
      const list = pluckArray<EvolutionRunDto>(res, "runs");
      setRuns(list);
      setSelectedId((prev) => prev ?? list[0]?.id ?? null);
    } catch (err) {
      setRuns([]);
      toast(describeError(err), "err");
    }
  }, [toast]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const trigger = async () => {
    setRunning(true);
    try {
      const res = await api.post<unknown>("/api/admin/evolve", { windowDays });
      const run = pluckOne<EvolutionRunDto>(res, "run");
      await load();
      if (run) setSelectedId(run.id);
      toast(
        run && run.proposals.length > 0
          ? `复盘完成，产出 ${run.proposals.length} 条提示词提案`
          : "复盘完成，报告已生成",
      );
    } catch (err) {
      toast(describeError(err), "err");
    } finally {
      setRunning(false);
    }
  };

  const selected = runs?.find((r) => r.id === selectedId) ?? null;
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;

  return (
    <section className="flex flex-col gap-5">
      <SectionHead
        title="自进化复盘"
        en="SELF-EVOLUTION"
        desc="「复盘」分析师通读窗口期内的调用日志、评审得分与最差草稿，写出改进报告，并对确有数据支撑的智能体提出新版提示词提案。"
      >
        <label className="flex items-center gap-2 text-[12.5px] font-bold text-soot">
          窗口
          <select
            value={windowDays}
            title="复盘统计的回看天数"
            onChange={(e) => setWindowDays(Number(e.target.value))}
            className={selectCls}
          >
            {WINDOW_OPTIONS.map((d) => (
              <option key={d} value={d}>
                近 {d} 天
              </option>
            ))}
          </select>
        </label>
        <Tip tip="立即对所选窗口做一次复盘分析；窗口内完成任务少于 3 个时会因样本不足而跳过">
          <button
            type="button"
            disabled={running}
            onClick={() => void trigger()}
            className={inkBtnCls}
          >
            {running ? "复盘中…" : "✦ 触发复盘"}
          </button>
        </Tip>
        <Tip tip="无需手动盯着：系统每完成 10 个任务会自动触发一次复盘（设置项 auto_evolve_after_tasks）。提案默认不自动生效，需在提示词抽屉中人工启用。">
          <span className="cursor-help rounded-full border-2 border-ink bg-sun px-3 py-1.5 text-[12px] font-bold">
            自动复盘 ⓘ
          </span>
        </Tip>
      </SectionHead>

      {runs === null ? (
        <LoadingRow label="正在读取复盘记录…" />
      ) : runs.length === 0 ? (
        <EmptyHint
          icon="✦"
          title="还没有复盘记录"
          next="点击上方「触发复盘」生成第一份改进报告；积累 3 个以上已完成任务效果最佳。"
        />
      ) : (
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[280px_1fr]">
          {/* run history */}
          <div className="flex flex-col gap-2">
            <div className="font-grotesk text-[11px] font-bold tracking-[2px] text-stone">
              RUN HISTORY
            </div>
            {runs.map((run) => {
              const active = run.id === selectedId;
              return (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => setSelectedId(run.id)}
                  title="查看这次复盘的报告与提案"
                  className={`cursor-pointer rounded-xl border-2 px-3.5 py-2.5 text-left transition-colors ${
                    active
                      ? "border-ink bg-ink text-paper shadow-[4px_4px_0_#FFC53D]"
                      : "border-ink bg-paper hover:bg-cream"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full border-[1.5px] px-2 py-px text-[10.5px] font-bold ${
                        run.trigger === "auto"
                          ? "border-ink bg-klein text-paper"
                          : active
                            ? "border-paper bg-transparent text-paper"
                            : "border-ink bg-cream text-ink"
                      }`}
                    >
                      {run.trigger === "auto" ? "自动" : "手动"}
                    </span>
                    <span className="font-mono text-[11.5px]">{fmtTime(run.ts)}</span>
                  </div>
                  <div className={`mt-1 text-[12px] ${active ? "text-tan-light" : "text-soot"}`}>
                    {run.proposals.length > 0
                      ? `${run.proposals.length} 条提示词提案`
                      : "无提案，仅报告"}
                  </div>
                </button>
              );
            })}
          </div>

          {/* selected run detail */}
          {selected ? (
            <div className="flex min-w-0 flex-col gap-5">
              <div className="rounded-[18px] border-2 border-ink bg-paper p-6 shadow-[6px_6px_0_#FFC53D]">
                <div className="mb-3 font-grotesk text-[11px] font-bold tracking-[2px] text-stone">
                  IMPROVEMENT REPORT · {fmtTime(selected.ts)}
                </div>
                <MarkdownLite md={selected.reportMd} />
              </div>

              <div className="flex flex-col gap-3">
                <div className="font-grotesk text-[11px] font-bold tracking-[2px] text-stone">
                  PROMPT PROPOSALS · {selected.proposals.length}
                </div>
                {selected.proposals.length === 0 ? (
                  <div className="rounded-xl border-[1.5px] border-dashed border-tan-mid bg-paper px-4 py-4 text-[13px] text-soot">
                    本次复盘没有产出提案——说明数据上暂无明显短板。继续积累任务后再试。
                  </div>
                ) : (
                  selected.proposals.map((p, idx) => (
                    <ProposalCard
                      key={`${p.agentId}-${idx}`}
                      agentId={p.agentId}
                      agentName={agentName(p.agentId)}
                      fromVersion={p.fromVersion}
                      toVersion={p.toVersion}
                      rationale={p.rationale}
                      onOpenPrompts={onOpenPrompts}
                    />
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** One proposal: agent, version bump, rationale, lazy template viewer. */
function ProposalCard({
  agentId,
  agentName,
  fromVersion,
  toVersion,
  rationale,
  onOpenPrompts,
}: {
  agentId: string;
  agentName: string;
  fromVersion: number;
  toVersion: number;
  rationale: string;
  onOpenPrompts: (agentId: string) => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [template, setTemplate] = useState<string | null>(null);
  const [status, setStatus] = useState<PromptVersionDto["status"] | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (template != null) return;
    setLoading(true);
    try {
      const res = await api.get<unknown>(`/api/admin/agents/${agentId}/prompts`);
      const version = pluckArray<PromptVersionDto>(res, "prompts").find(
        (v) => v.version === toVersion,
      );
      setTemplate(version?.template ?? "（未找到该版本，可能已被清理）");
      setStatus(version?.status ?? null);
    } catch (err) {
      setTemplate(null);
      setOpen(false);
      toast(describeError(err), "err");
    } finally {
      setLoading(false);
    }
  };

  const pending = status == null || status === "proposed";

  return (
    <div className="rounded-[18px] border-2 border-ink bg-paper p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[14.5px] font-bold">{agentName}</span>
        <span className="font-mono text-[11px] text-stone">{agentId}</span>
        <span className="rounded-full border-[1.5px] border-ink bg-cream px-2.5 py-px font-archivo text-[11.5px]">
          v{fromVersion} → v{toVersion}
        </span>
        {pending ? (
          <span className="rounded-full border-[1.5px] border-ink bg-sun px-2.5 py-[2px] text-[11px] font-bold">
            待启用
          </span>
        ) : (
          <span className="rounded-full border-[1.5px] border-ink bg-jade px-2.5 py-[2px] text-[11px] font-bold text-paper">
            已启用
          </span>
        )}
      </div>
      <p className="mt-2.5 text-[13px] leading-[1.85] text-soot">{rationale}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={() => void toggle()}
          title="展开查看提案的完整新版提示词模板"
          className={paperBtnCls}
        >
          {open ? "收起模板" : loading ? "加载中…" : "查看新模板"}
        </button>
        <Tip tip="打开该智能体的提示词抽屉，确认无误后点「启用此版本」让提案生效">
          <button type="button" onClick={() => onOpenPrompts(agentId)} className={inkBtnCls}>
            去启用 →
          </button>
        </Tip>
        {pending ? (
          <span className="text-[11.5px] text-stone">提案不会自动生效，需人工启用</span>
        ) : null}
      </div>
      {open && template != null ? (
        <pre className="mt-3 max-h-[300px] overflow-y-auto rounded-xl border-[1.5px] border-tan bg-cream p-4 font-mono text-[12px] leading-[1.75] break-words whitespace-pre-wrap text-ink">
          {template}
        </pre>
      ) : null}
    </div>
  );
}
