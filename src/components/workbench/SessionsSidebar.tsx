"use client";

import { useState } from "react";
import type { TaskStatus, TaskSummary } from "@/lib/api-types";
import { getPlatform } from "@/lib/platforms";

/** Status pill styling per TaskStatus, in the pop-collage palette. */
const STATUS_META: Record<TaskStatus, { label: string; cls: string }> = {
  briefing: { label: "简报中", cls: "bg-sun text-ink" },
  running: { label: "创作中", cls: "bg-klein text-paper" },
  reviewing: { label: "复核中", cls: "bg-rose text-ink" },
  done: { label: "已交付", cls: "bg-jade text-paper" },
  failed: { label: "失败", cls: "bg-poppy text-paper" },
  cancelled: { label: "已取消", cls: "bg-sand text-soot" },
};

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const mins = Math.floor((Date.now() - t) / 60_000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const d = new Date(t);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function formatCost(usd: number): string {
  if (usd <= 0) return "$0";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

export interface SessionsSidebarProps {
  tasks: TaskSummary[];
  activeId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

/**
 * Workbench left rail: task history (req 6 — load a previous session and
 * continue) + 新建任务 entry. Pure presentational: all data/actions arrive
 * via props from the workbench shell. Designed for a 240px cream column.
 */
export function SessionsSidebar({
  tasks,
  activeId,
  loading,
  onSelect,
  onNew,
  onDelete,
}: SessionsSidebarProps) {
  /** task id with the delete-confirm popover open */
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // If the task pending confirmation disappears (deleted elsewhere), the
  // popover simply stops rendering — derive instead of syncing state.
  const openConfirmId =
    confirmId && tasks.some((t) => t.id === confirmId) ? confirmId : null;

  return (
    <aside className="flex h-full w-full min-w-0 flex-col border-r-2 border-ink bg-cream">
      {/* header */}
      <div className="shrink-0 px-4 pb-3 pt-5">
        <div className="text-[16px] font-black">任务列表</div>
        <div className="font-grotesk text-[10.5px] font-bold tracking-[2px] text-stone">
          SESSIONS
        </div>
      </div>

      {/* new task */}
      <div className="shrink-0 px-4 pb-4">
        <button
          type="button"
          onClick={onNew}
          title="开启一份新简报，灰灰带你 5 步派单"
          className="w-full cursor-pointer rounded-[14px] border-2 border-ink bg-poppy px-4 py-[11px] text-[14.5px] font-bold text-paper shadow-[4px_4px_0_#17130C] transition-transform hover:-translate-y-0.5"
        >
          ＋ 新建任务
        </button>
      </div>

      {/* task list */}
      <div className="scrollbar-chat flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-4">
        {loading &&
          [0, 1, 2].map((i) => (
            <div
              key={i}
              className="animate-pulse rounded-xl border-[1.5px] border-tan bg-paper/70 px-3 py-3"
            >
              <div className="mb-2 h-3 w-3/4 rounded bg-sand" />
              <div className="h-2.5 w-1/2 rounded bg-sand" />
            </div>
          ))}

        {!loading && tasks.length === 0 && (
          <div className="px-2 pt-2 text-center">
            <div className="font-archivo text-[26px] leading-none text-tan-dark">
              ↑
            </div>
            <div className="mt-2 text-[13.5px] font-bold text-soot">
              还没有任务
            </div>
            <p className="mt-1.5 text-[12px] leading-[1.8] text-stone">
              点击上方「新建任务」开始第一份简报。
              完成的任务都会保存在这里，随时点开继续修改、回炉重做。
            </p>
          </div>
        )}

        {!loading &&
          tasks.map((task) => {
            const meta = STATUS_META[task.status];
            const active = task.id === activeId;
            return (
              <div key={task.id} className="group relative">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(task.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(task.id);
                    }
                  }}
                  title={`打开任务「${task.title}」继续工作`}
                  className={`cursor-pointer rounded-xl border-[1.5px] px-3 py-2.5 transition-colors ${
                    active
                      ? "border-ink bg-paper shadow-[3px_3px_0_#17130C]"
                      : "border-tan bg-paper/70 hover:border-tan-dark hover:bg-paper"
                  }`}
                >
                  <div className="truncate pr-5 text-[13px] font-bold leading-snug">
                    {task.title || "未命名任务"}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${meta.cls}`}
                    >
                      {meta.label}
                    </span>
                    <span className="truncate text-[11px] text-stone">
                      {relativeTime(task.updatedAt)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div
                      className="flex items-center gap-1"
                      title={task.platforms
                        .map((id) => getPlatform(id).name)
                        .join("、")}
                    >
                      {task.platforms.map((id) => (
                        <span
                          key={id}
                          className="h-2 w-2 rounded-full border border-ink/20"
                          style={{ background: getPlatform(id).color }}
                          aria-label={getPlatform(id).name}
                        />
                      ))}
                    </div>
                    <span
                      className="rounded-full border border-tan-mid bg-cream px-1.5 py-px font-archivo text-[10px] text-soot"
                      title={`本任务累计成本 ${formatCost(task.costUsd)}（${task.tokens.toLocaleString("zh-CN")} tokens）`}
                    >
                      {formatCost(task.costUsd)}
                    </span>
                  </div>
                </div>

                {/* delete (hover) */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmId(task.id);
                  }}
                  title="删除该任务"
                  aria-label="删除该任务"
                  className="absolute right-1.5 top-1.5 hidden h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-tan-mid bg-paper text-[11px] leading-none text-stone hover:border-poppy hover:text-poppy group-hover:flex group-focus-within:flex"
                >
                  ×
                </button>

                {/* confirm popover (no window.confirm) */}
                {openConfirmId === task.id && (
                  <div className="absolute right-1 top-7 z-20 w-[186px] rounded-xl border-2 border-ink bg-paper p-3 shadow-[4px_4px_0_#17130C]">
                    <div className="text-[12.5px] font-bold leading-snug">
                      删除「{task.title || "未命名任务"}」？
                    </div>
                    <div className="mt-1 text-[11px] leading-[1.6] text-stone">
                      聊天记录与生成结果将一并删除，无法恢复。
                    </div>
                    <div className="mt-2.5 flex gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmId(null);
                          onDelete(task.id);
                        }}
                        title="确认删除，不可恢复"
                        className="flex-1 cursor-pointer rounded-lg border-[1.5px] border-ink bg-poppy px-2 py-1.5 text-[12px] font-bold text-paper"
                      >
                        删除
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmId(null);
                        }}
                        title="保留这个任务"
                        className="flex-1 cursor-pointer rounded-lg border-[1.5px] border-tan-mid bg-paper px-2 py-1.5 text-[12px] font-bold text-soot"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </aside>
  );
}
