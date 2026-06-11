"use client";

import type { AgentDto, ModelDto } from "@/lib/api-types";
import { EmptyHint, InkToggle, LoadingRow, SectionHead, selectCls } from "./ui";

export interface AgentPatch {
  modelId?: string;
  fallbackModelId?: string | null;
  enabled?: boolean;
}

/**
 * 智能体 AGENTS — the full agent roster: enable/disable, per-agent model and
 * fallback model dropdowns (req 19), and the prompt-version badge that opens
 * the tuning drawer (req 2).
 */
export function AgentsSection({
  agents,
  models,
  loading,
  busyIds,
  onPatch,
  onOpenPrompts,
}: {
  agents: AgentDto[];
  models: ModelDto[];
  loading: boolean;
  /** agent ids with an in-flight PUT */
  busyIds: Set<string>;
  onPatch: (id: string, patch: AgentPatch) => void;
  onOpenPrompts: (agentId: string) => void;
}) {
  // Agents run on text-capable models; image-only models stay out of the list.
  const pickable = models.filter(
    (m) => m.enabled && (m.kind === "text" || m.kind === "multimodal"),
  );

  const optionsFor = (current: string | undefined): string[] => {
    const ids = pickable.map((m) => m.id);
    // Keep the currently-assigned model visible even if it was since disabled.
    if (current && !ids.includes(current)) ids.unshift(current);
    return ids;
  };

  return (
    <section className="flex flex-col gap-5">
      <SectionHead
        title="智能体编队"
        en="AGENT ROSTER"
        desc="内容部的全部 AI 角色。在这里切换主模型 / 备用模型、上下线智能体，点击版本徽章可调教它的系统提示词。"
      />

      {loading ? (
        <LoadingRow label="正在读取智能体名单…" />
      ) : agents.length === 0 ? (
        <EmptyHint
          title="还没有智能体"
          next="种子数据尚未写入。先在终端运行一次 npm run seed，再刷新本页。"
        />
      ) : (
        <div className="overflow-hidden rounded-[18px] border-2 border-ink bg-paper shadow-[6px_6px_0_#FF4B2E]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-left">
              <thead>
                <tr className="border-b-2 border-ink bg-cream font-grotesk text-[11px] font-bold tracking-[2px] text-stone">
                  <th className="px-5 py-3">AGENT</th>
                  <th className="px-3 py-3">启用</th>
                  <th className="px-3 py-3">主模型 MODEL</th>
                  <th className="px-3 py-3">备用 FALLBACK</th>
                  <th className="px-5 py-3">提示词 PROMPT</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => {
                  const busy = busyIds.has(agent.id);
                  return (
                    <tr
                      key={agent.id}
                      className={`border-b border-tan-light last:border-b-0 ${
                        agent.enabled ? "" : "opacity-55"
                      }`}
                    >
                      <td className="px-5 py-3.5 align-top">
                        <div className="text-[14.5px] font-bold">
                          {agent.name}
                          <span className="ml-2 text-[12px] font-normal text-soot">
                            {agent.roleTitle}
                          </span>
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-stone">
                          {agent.id}
                        </div>
                      </td>
                      <td className="px-3 py-3.5 align-top">
                        <InkToggle
                          on={agent.enabled}
                          busy={busy}
                          label={
                            agent.enabled
                              ? `停用 ${agent.name}（流水线将跳过或降级该角色）`
                              : `启用 ${agent.name}`
                          }
                          onChange={(next) => onPatch(agent.id, { enabled: next })}
                        />
                      </td>
                      <td className="px-3 py-3.5 align-top">
                        <select
                          value={agent.modelId}
                          disabled={busy}
                          title={`${agent.name} 的主力模型`}
                          onChange={(e) => onPatch(agent.id, { modelId: e.target.value })}
                          className={`${selectCls} max-w-[230px]`}
                        >
                          {optionsFor(agent.modelId).map((id) => (
                            <option key={id} value={id}>
                              {id}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-3.5 align-top">
                        <select
                          value={agent.fallbackModelId ?? ""}
                          disabled={busy}
                          title={`${agent.name} 的备用模型：主模型超时或报错时自动降级使用`}
                          onChange={(e) =>
                            onPatch(agent.id, {
                              fallbackModelId: e.target.value === "" ? null : e.target.value,
                            })
                          }
                          className={`${selectCls} max-w-[230px]`}
                        >
                          <option value="">（无备用）</option>
                          {optionsFor(agent.fallbackModelId ?? undefined)
                            .filter((id) => id !== "")
                            .map((id) => (
                              <option key={id} value={id}>
                                {id}
                              </option>
                            ))}
                        </select>
                      </td>
                      <td className="px-5 py-3.5 align-top">
                        {/* title (not Tip): a hover bubble would clip inside the
                            table's overflow-x-auto scroll container */}
                        <button
                          type="button"
                          onClick={() => onOpenPrompts(agent.id)}
                          title={`查看 / 调教 ${agent.name} 的系统提示词版本`}
                          className="cursor-pointer rounded-full border-2 border-ink bg-sun px-3 py-1 text-[12px] font-bold whitespace-nowrap transition-transform hover:-translate-y-px"
                        >
                          <span className="font-archivo">
                            v{agent.activePromptVersion || "—"}
                          </span>
                          <span className="ml-1.5 text-soot">
                            · {agent.promptCount} 个版本
                          </span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
