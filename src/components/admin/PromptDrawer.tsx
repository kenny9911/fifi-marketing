"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Tip } from "@/components/shared/Tip";
import { api } from "@/lib/client-api";
import type { AgentDto, PromptVersionDto } from "@/lib/api-types";
import { describeError, fmtTime, pluckArray } from "./types";
import { EmptyHint, LoadingRow, StatusPill, inkBtnCls, paperBtnCls, useToast } from "./ui";

type DiffLine = { type: "same" | "add" | "del"; text: string };

/**
 * Line-level LCS diff: `del` lines exist only in `from`, `add` lines only in
 * `to`. O(n·m) DP — prompt templates are small enough that this is instant.
 */
function diffLines(from: string, to: string): DiffLine[] {
  const a = from.split("\n");
  const b = to.split("\n");
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = LCS length of a[i:] and b[j:]
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: "del", text: a[i] });
      i++;
    } else {
      out.push({ type: "add", text: b[j] });
      j++;
    }
  }
  for (; i < n; i++) out.push({ type: "del", text: a[i] });
  for (; j < m; j++) out.push({ type: "add", text: b[j] });
  return out;
}

const DIFF_LINE_CLS: Record<DiffLine["type"], string> = {
  same: "text-soot",
  add: "bg-[#E5F6EE] text-[#0B6B47]",
  del: "bg-[#FFE9E4] text-poppy line-through decoration-poppy/40",
};

const DIFF_PREFIX: Record<DiffLine["type"], string> = {
  same: "  ",
  add: "+ ",
  del: "- ",
};

/**
 * Slide-over prompt tuner (req 2): per-agent version history, template viewer
 * with a diff against the active version (diff + activate per SPEC §6 —
 * defaults to diff view when a proposed version is selected), one-click
 * activation, and a "new version" editor prefilled from the current active
 * template (保存为草稿 / 保存并启用).
 */
export function PromptDrawer({
  agent,
  onClose,
  onChanged,
}: {
  agent: AgentDto;
  onClose: () => void;
  /** called after activate / create so the parent refetches the roster */
  onChanged: () => void;
}) {
  const toast = useToast();
  const [shown, setShown] = useState(false);
  const [loading, setLoading] = useState(true);
  const [versions, setVersions] = useState<PromptVersionDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  /** diff-vs-active toggle; null = auto (on for proposed versions) */
  const [diffPref, setDiffPref] = useState<boolean | null>(null);

  // new-version editor
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState<"draft" | "activate" | null>(null);

  // NB: no synchronous setLoading(true) here — `loading` starts true and the
  // drawer keeps the stale list visible during refetches after activate/save.
  const load = useCallback(async () => {
    try {
      const res = await api.get<unknown>(`/api/admin/agents/${agent.id}/prompts`);
      const list = pluckArray<PromptVersionDto>(res, "prompts").slice();
      list.sort((a, b) => b.version - a.version);
      setVersions(list);
      setSelectedId((prev) => {
        if (prev && list.some((v) => v.id === prev)) return prev;
        return (list.find((v) => v.status === "active") ?? list[0])?.id ?? null;
      });
    } catch (err) {
      toast(describeError(err), "err");
    } finally {
      setLoading(false);
    }
  }, [agent.id, toast]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  // slide-in on mount + Esc to close
  useEffect(() => {
    const t = window.setTimeout(() => setShown(true), 10);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const active = versions.find((v) => v.status === "active") ?? null;
  const selected = versions.find((v) => v.id === selectedId) ?? null;

  // Diff vs the active version (SPEC §6 diff + activate): available whenever
  // a non-active version is selected; defaults ON for proposed versions so an
  // evolution proposal is reviewed as a change-set, not by eyeballing.
  const canDiff = Boolean(active && selected && selected.id !== active.id);
  const showDiff = canDiff && (diffPref ?? selected?.status === "proposed");
  const diff = useMemo<DiffLine[]>(
    () =>
      showDiff && active && selected ? diffLines(active.template, selected.template) : [],
    [showDiff, active, selected],
  );
  const changedLines = diff.filter((l) => l.type !== "same").length;

  const openEditor = () => {
    setDraft(active?.template ?? selected?.template ?? "");
    setNotes("");
    setEditing(true);
  };

  const activate = async (promptId: string) => {
    setActivatingId(promptId);
    try {
      await api.post<unknown>(`/api/admin/prompts/${promptId}/activate`);
      toast("已切换启用版本");
      await load();
      onChanged();
    } catch (err) {
      toast(describeError(err), "err");
    } finally {
      setActivatingId(null);
    }
  };

  const saveNew = async (activateNow: boolean) => {
    if (!draft.trim()) {
      toast("提示词模板不能为空", "err");
      return;
    }
    setSaving(activateNow ? "activate" : "draft");
    try {
      await api.post<unknown>(`/api/admin/agents/${agent.id}/prompts`, {
        template: draft,
        notes: notes.trim() || "管理员手动调整",
        activate: activateNow,
      });
      toast(activateNow ? "新版本已保存并启用" : "已保存为草稿版本");
      setEditing(false);
      await load();
      onChanged();
    } catch (err) {
      toast(describeError(err), "err");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={`${agent.name} 的提示词版本`}>
      {/* ink overlay */}
      <button
        type="button"
        aria-label="关闭抽屉"
        title="点击空白处关闭"
        onClick={onClose}
        className={`absolute inset-0 cursor-pointer bg-ink/55 transition-opacity duration-200 ${
          shown ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* panel */}
      <aside
        className={`absolute top-0 right-0 flex h-full w-full max-w-[640px] flex-col border-l-2 border-ink bg-paper transition-transform duration-200 ${
          shown ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b-2 border-ink bg-cream px-6 py-4">
          <div className="min-w-0">
            <div className="truncate text-[17px] font-black">
              {agent.name}
              <span className="ml-2 text-[12.5px] font-normal text-soot">{agent.roleTitle}</span>
            </div>
            <div className="font-grotesk text-[10.5px] font-bold tracking-[2px] text-stone">
              PROMPT VERSIONS · <span className="font-mono tracking-normal">{agent.id}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="关闭（Esc）"
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 border-ink bg-paper text-[14px] font-bold transition-colors hover:bg-sun"
          >
            ✕
          </button>
        </header>

        <div className="scrollbar-chat min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <LoadingRow label="正在读取版本历史…" />
          ) : versions.length === 0 ? (
            <EmptyHint
              title="该智能体还没有提示词版本"
              next="点击下方「新建版本」写入第一版系统提示词，保存并启用后即刻生效。"
            />
          ) : (
            <div className="flex flex-col gap-5">
              {/* version list */}
              <div className="flex flex-col gap-2">
                <div className="font-grotesk text-[11px] font-bold tracking-[2px] text-stone">
                  VERSION HISTORY
                </div>
                {versions.map((v) => {
                  const isSelected = v.id === selectedId;
                  return (
                    <div
                      key={v.id}
                      className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border-[1.5px] px-3.5 py-2.5 ${
                        isSelected ? "border-ink bg-cream" : "border-tan bg-paper"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(v.id);
                          setDiffPref(null); // 换版本回到自动：提案默认看差异
                        }}
                        title={`查看 v${v.version} 模板内容`}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                      >
                        <span className="font-archivo text-[15px]">v{v.version}</span>
                        <StatusPill status={v.status} />
                        <span className="text-[12px] text-soot">
                          {v.scoreAvg != null ? (
                            <>
                              <span className="font-archivo text-[12.5px] text-ink">
                                {v.scoreAvg.toFixed(1)}
                              </span>{" "}
                              分 · {v.scoreN} 次评审
                            </>
                          ) : (
                            "暂无评分"
                          )}
                        </span>
                        <span className="ml-auto font-mono text-[11px] text-stone">
                          {fmtTime(v.createdAt)}
                        </span>
                      </button>
                      {v.status !== "active" ? (
                        <Tip tip="将此版本设为该智能体的现行系统提示词（原版本自动退役）">
                          <button
                            type="button"
                            disabled={activatingId != null}
                            onClick={() => void activate(v.id)}
                            className="cursor-pointer rounded-full border-[1.5px] border-ink bg-jade px-3 py-[3px] text-[11.5px] font-bold text-paper transition-transform hover:-translate-y-px disabled:cursor-wait disabled:opacity-50"
                          >
                            {activatingId === v.id ? "启用中…" : "启用此版本"}
                          </button>
                        </Tip>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {/* template viewer: raw template or line diff vs the active version */}
              {selected ? (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <div className="flex items-baseline gap-2.5">
                      <div className="font-grotesk text-[11px] font-bold tracking-[2px] text-stone">
                        {showDiff && active
                          ? `DIFF · v${active.version} → v${selected.version}`
                          : `TEMPLATE · v${selected.version}`}
                      </div>
                      {canDiff && (
                        <Tip
                          tip={
                            showDiff
                              ? "切换回完整模板原文"
                              : `逐行对比此版本与现行启用版 v${active?.version}`
                          }
                        >
                          <button
                            type="button"
                            onClick={() => setDiffPref(!showDiff)}
                            className="cursor-pointer rounded-full border-[1.5px] border-ink bg-paper px-2.5 py-[2px] text-[11px] font-bold transition-colors hover:bg-sun"
                          >
                            {showDiff ? "查看原文" : "对比启用版"}
                          </button>
                        </Tip>
                      )}
                    </div>
                    {selected.notes ? (
                      <div className="max-w-[60%] truncate text-[11.5px] text-soot" title={selected.notes}>
                        备注：{selected.notes}
                      </div>
                    ) : null}
                  </div>
                  {showDiff && active ? (
                    changedLines === 0 ? (
                      <div className="rounded-xl border-[1.5px] border-tan bg-cream px-4 py-3 text-[12.5px] text-soot">
                        与启用版 v{active.version} 内容完全一致，没有差异。
                      </div>
                    ) : (
                      <pre className="max-h-[340px] overflow-y-auto rounded-xl border-[1.5px] border-tan bg-cream p-4 font-mono text-[12px] leading-[1.75]">
                        {diff.map((line, idx) => (
                          <div
                            key={idx}
                            className={`break-words whitespace-pre-wrap ${DIFF_LINE_CLS[line.type]}`}
                          >
                            {DIFF_PREFIX[line.type]}
                            {line.text || " "}
                          </div>
                        ))}
                      </pre>
                    )
                  ) : (
                    <pre className="max-h-[340px] overflow-y-auto rounded-xl border-[1.5px] border-tan bg-cream p-4 font-mono text-[12px] leading-[1.75] break-words whitespace-pre-wrap text-ink">
                      {selected.template}
                    </pre>
                  )}
                </div>
              ) : null}
            </div>
          )}

          {/* new version editor */}
          <div className="mt-6 border-t-2 border-dashed border-tan pt-5 pb-2">
            {!editing ? (
              <Tip tip="复制当前启用版本作为底稿，微调后保存为新版本">
                <button type="button" onClick={openEditor} className={inkBtnCls}>
                  ✎ 新建版本（基于 v{active?.version ?? "—"}）
                </button>
              </Tip>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="font-grotesk text-[11px] font-bold tracking-[2px] text-stone">
                  NEW VERSION DRAFT
                </div>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={12}
                  title="系统提示词模板，支持 {{var}} 占位符"
                  placeholder="系统提示词模板，{{goal}}、{{audience}} 等占位符会在运行时注入…"
                  className="w-full resize-y rounded-xl border-[1.5px] border-tan bg-cream p-4 font-mono text-[12px] leading-[1.75] text-ink outline-none focus:border-ink"
                />
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  title="版本备注：记录这次改了什么、为什么改"
                  placeholder="版本备注（如：收紧开头钩子要求，补充合规红线）"
                  className="w-full rounded-xl border-[1.5px] border-tan bg-paper px-4 py-2.5 text-[13px] outline-none focus:border-ink"
                />
                <div className="flex flex-wrap items-center gap-2.5">
                  <Tip tip="保存为草稿版本，不影响线上，可稍后再启用">
                    <button
                      type="button"
                      disabled={saving != null}
                      onClick={() => void saveNew(false)}
                      className={paperBtnCls}
                    >
                      {saving === "draft" ? "保存中…" : "保存为草稿"}
                    </button>
                  </Tip>
                  <Tip tip="保存新版本并立即设为现行提示词">
                    <button
                      type="button"
                      disabled={saving != null}
                      onClick={() => void saveNew(true)}
                      className={inkBtnCls}
                    >
                      {saving === "activate" ? "保存中…" : "保存并启用"}
                    </button>
                  </Tip>
                  <button
                    type="button"
                    disabled={saving != null}
                    onClick={() => setEditing(false)}
                    title="放弃这份草稿"
                    className="cursor-pointer rounded-full px-3 py-1.5 text-[12.5px] font-bold text-stone hover:text-ink"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
