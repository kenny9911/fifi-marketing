"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Tip } from "@/components/shared/Tip";
import { api } from "@/lib/client-api";
import type { SkillDto } from "@/lib/api-types";
import { PLATFORMS } from "@/lib/platforms";
import { describeError, fmtTime, pluckArray } from "./types";
import {
  EmptyHint,
  LoadingRow,
  SectionHead,
  inkBtnCls,
  paperBtnCls,
  useToast,
} from "./ui";

/**
 * 技能 SKILLS — the reusable platform know-how injected into crafter prompts
 * (标题规则 / 结构模板 / 平台雷区 / 流量机制…). Grouped by platform with
 * edit-in-place textareas; each save bumps the skill version.
 */
export function SkillsSection() {
  const toast = useToast();
  const [skills, setSkills] = useState<SkillDto[] | null>(null);
  // id → edited content; key absent = pristine
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<unknown>("/api/admin/skills");
      setSkills(pluckArray<SkillDto>(res, "skills"));
    } catch (err) {
      setSkills([]);
      toast(describeError(err), "err");
    }
  }, [toast]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const groups = useMemo(() => {
    const list = skills ?? [];
    const byPlatform = PLATFORMS.map((p) => ({
      key: p.id as string,
      name: p.name,
      en: p.expert.en,
      color: p.uiColor,
      items: list.filter((s) => s.platform === p.id),
    })).filter((g) => g.items.length > 0);
    const general = list.filter(
      (s) => s.platform == null || !PLATFORMS.some((p) => p.id === s.platform),
    );
    if (general.length > 0) {
      byPlatform.push({
        key: "general",
        name: "通用",
        en: "GENERAL",
        color: "#17130C",
        items: general,
      });
    }
    return byPlatform;
  }, [skills]);

  const save = async (skill: SkillDto) => {
    const content = drafts[skill.id];
    if (content == null || content === skill.content) return;
    if (!content.trim()) {
      toast("技能内容不能为空", "err");
      return;
    }
    setSavingId(skill.id);
    try {
      await api.put<unknown>("/api/admin/skills", { id: skill.id, content });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[skill.id];
        return next;
      });
      await load();
      toast(`已保存「${skill.name}」，版本 +1`);
    } catch (err) {
      toast(describeError(err), "err");
    } finally {
      setSavingId(null);
    }
  };

  const revert = (id: string) => {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  return (
    <section className="flex flex-col gap-5">
      <SectionHead
        title="平台技能库"
        en="SKILL LIBRARY"
        desc="撰稿专家随身携带的平台心法：标题规则、结构模板、平台雷区、流量机制。改完保存即生效（版本号 +1），下一次出稿就会用上。"
      />

      {skills === null ? (
        <LoadingRow label="正在读取技能库…" />
      ) : skills.length === 0 ? (
        <EmptyHint
          title="技能库是空的"
          next="运行 npm run seed 写入各平台默认心法，或等自进化复盘提出补充建议。"
        />
      ) : (
        <div className="flex flex-col gap-7">
          {groups.map((group) => (
            <div key={group.key} className="flex flex-col gap-3">
              <div className="flex items-center gap-2.5">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border-2 border-ink px-3 py-1 text-[12.5px] font-bold text-white"
                  style={{ background: group.color }}
                >
                  {group.name}
                </span>
                <span className="font-grotesk text-[10.5px] font-bold tracking-[2px] text-stone">
                  {group.en} · {group.items.length} 项
                </span>
              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {group.items.map((skill) => {
                  const draft = drafts[skill.id];
                  const dirty = draft != null && draft !== skill.content;
                  const value = draft ?? skill.content;
                  return (
                    <div
                      key={skill.id}
                      className="flex flex-col gap-2.5 rounded-[18px] border-2 border-ink bg-paper p-4"
                      style={{ boxShadow: `5px 5px 0 ${group.color}` }}
                    >
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-[14.5px] font-bold">{skill.name}</span>
                        <span
                          className="rounded-full border-[1.5px] border-ink bg-cream px-2 py-px font-archivo text-[10.5px]"
                          title="当前版本号，每次保存 +1"
                        >
                          v{skill.version}
                        </span>
                        <span className="ml-auto font-mono text-[10.5px] text-stone">
                          {skill.id}
                        </span>
                      </div>
                      <textarea
                        value={value}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [skill.id]: e.target.value }))
                        }
                        rows={Math.min(12, Math.max(5, value.split("\n").length + 1))}
                        title={`编辑「${skill.name}」的知识内容（Markdown）`}
                        className="w-full resize-y rounded-xl border-[1.5px] border-tan bg-cream p-3 font-mono text-[12px] leading-[1.75] text-ink outline-none focus:border-ink"
                      />
                      <div className="flex items-center gap-2.5">
                        <Tip tip="保存为新版本并立即注入后续出稿">
                          <button
                            type="button"
                            disabled={!dirty || savingId === skill.id}
                            onClick={() => void save(skill)}
                            className={inkBtnCls}
                          >
                            {savingId === skill.id ? "保存中…" : "保存"}
                          </button>
                        </Tip>
                        {dirty ? (
                          <button
                            type="button"
                            onClick={() => revert(skill.id)}
                            title="丢弃修改，恢复到已保存内容"
                            className={paperBtnCls}
                          >
                            还原
                          </button>
                        ) : (
                          <span className="text-[11.5px] text-stone">
                            更新于 {fmtTime(skill.updatedAt)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
