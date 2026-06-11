"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BurstStar } from "@/components/shared/BurstStar";
import { LogoMark } from "@/components/shared/LogoMark";
import { useSession } from "@/components/hooks/useSession";
import { api } from "@/lib/client-api";
import type { AgentDto, ModelDto } from "@/lib/api-types";
import { AgentsSection, type AgentPatch } from "./AgentsSection";
import { EvolutionSection } from "./EvolutionSection";
import { ModelsSection } from "./ModelsSection";
import { PromptDrawer } from "./PromptDrawer";
import { SkillsSection } from "./SkillsSection";
import { describeError, pluckArray, pluckOne } from "./types";
import { ToastProvider, useToast } from "./ui";

type TabId = "agents" | "models" | "skills" | "evolve";

const TABS: { id: TabId; label: string; en: string; color: string }[] = [
  { id: "agents", label: "智能体", en: "AGENTS", color: "#FF4B2E" },
  { id: "models", label: "模型", en: "MODELS", color: "#2849F4" },
  { id: "skills", label: "技能", en: "SKILLS", color: "#0FA36B" },
  { id: "evolve", label: "自进化", en: "EVOLUTION", color: "#FFC53D" },
];

/** /admin entry: session guard wrapping the actual console. */
export function AdminConsole() {
  const { user, loading } = useSession();

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-cream">
        <div className="flex items-center gap-3 text-[14px] font-bold text-soot">
          <span className="animate-blink h-2.5 w-2.5 rounded-full bg-poppy" />
          <span className="animate-blink h-2.5 w-2.5 rounded-full bg-klein [animation-delay:.2s]" />
          正在确认身份…
        </div>
      </div>
    );
  }

  if (!user || user.role !== "admin") {
    return <ForbiddenCard loggedIn={user != null} />;
  }

  return (
    <ToastProvider>
      <ConsoleBody />
    </ToastProvider>
  );
}

/** Friendly 403 — non-admins get pointed back to where they belong. */
function ForbiddenCard({ loggedIn }: { loggedIn: boolean }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-cream px-6">
      <div className="relative w-full max-w-[460px] rounded-[22px] border-2 border-ink bg-paper p-9 text-center shadow-[8px_8px_0_#FF4B2E]">
        <BurstStar size={64} fill="#FFC53D" className="mx-auto" />
        <div className="mt-4 font-display text-[30px] font-normal leading-[1.3]">
          仅限管理员进入
        </div>
        <div className="mt-1 font-grotesk text-[11px] font-bold tracking-[3px] text-stone">
          403 · ADMIN ONLY
        </div>
        <p className="mt-4 text-[14px] leading-[1.9] text-soot">
          {loggedIn
            ? "当前账号没有管理控制台权限。如需调整智能体、模型或提示词，请联系管理员。"
            : "请先用管理员账号登录后再访问本页。"}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            href="/"
            title="回到首页"
            className="rounded-full border-2 border-ink bg-paper px-5 py-2 text-[13.5px] font-bold transition-colors hover:bg-cream"
          >
            返回首页
          </Link>
          <Link
            href={loggedIn ? "/studio" : "/login?next=/admin"}
            title={loggedIn ? "去创作台继续干活" : "前往登录页"}
            className="rounded-full border-2 border-ink bg-ink px-5 py-2 text-[13.5px] font-bold text-paper shadow-[3px_3px_0_#FFC53D] transition-transform hover:-translate-y-px"
          >
            {loggedIn ? "前往创作台 →" : "去登录 →"}
          </Link>
        </div>
      </div>
    </div>
  );
}

/** The console proper: topbar, tab chips, sections, prompt drawer. */
function ConsoleBody() {
  const toast = useToast();
  const [tab, setTab] = useState<TabId>("agents");

  const [agents, setAgents] = useState<AgentDto[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [busyAgentIds, setBusyAgentIds] = useState<Set<string>>(new Set());

  const [models, setModels] = useState<ModelDto[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);

  const [drawerAgentId, setDrawerAgentId] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    try {
      const res = await api.get<unknown>("/api/admin/agents");
      setAgents(pluckArray<AgentDto>(res, "agents"));
    } catch (err) {
      toast(describeError(err), "err");
    } finally {
      setAgentsLoading(false);
    }
  }, [toast]);

  const loadModels = useCallback(async () => {
    try {
      const res = await api.get<unknown>("/api/admin/models");
      setModels(pluckArray<ModelDto>(res, "models"));
    } catch (err) {
      toast(describeError(err), "err");
    } finally {
      setModelsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void (async () => {
      await Promise.all([loadAgents(), loadModels()]);
    })();
  }, [loadAgents, loadModels]);

  /** Optimistic agent update: flip UI now, PUT, reconcile or roll back. */
  const patchAgent = useCallback(
    async (id: string, patch: AgentPatch) => {
      const prev = agents;
      setAgents((list) =>
        list.map((a) =>
          a.id === id
            ? {
                ...a,
                modelId: patch.modelId ?? a.modelId,
                fallbackModelId:
                  patch.fallbackModelId === undefined
                    ? a.fallbackModelId
                    : (patch.fallbackModelId ?? undefined),
                enabled: patch.enabled ?? a.enabled,
              }
            : a,
        ),
      );
      setBusyAgentIds((s) => new Set(s).add(id));
      try {
        const res = await api.put<unknown>("/api/admin/agents", { id, ...patch });
        const fresh = pluckOne<AgentDto>(res, "agent");
        if (fresh && fresh.id === id) {
          setAgents((list) => list.map((a) => (a.id === id ? fresh : a)));
        }
        toast("已保存");
      } catch (err) {
        setAgents(prev);
        toast(describeError(err), "err");
      } finally {
        setBusyAgentIds((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      }
    },
    [agents, toast],
  );

  const drawerAgent = agents.find((a) => a.id === drawerAgentId) ?? null;

  return (
    <div className="min-h-dvh bg-cream">
      {/* topbar */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b-2 border-ink bg-cream px-7 py-4">
        <div className="flex items-center gap-2.5">
          <Link href="/" className="flex items-center gap-2.5" title="回到首页">
            <LogoMark size={22} />
            <span className="font-display text-[21px] leading-none font-normal">
              管理控制台
            </span>
          </Link>
          <span className="font-grotesk text-[11px] font-bold tracking-[2px] text-stone">
            ADMIN CONSOLE
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden rounded-full border-[1.5px] border-ink bg-sun px-3 py-1 text-[12px] font-bold sm:inline-block">
            管理员 ADMIN
          </span>
          <Link
            href="/studio"
            title="回到创作台"
            className="rounded-full border-[1.5px] border-ink bg-paper px-4 py-1.5 text-[13px] font-bold transition-colors hover:bg-sun"
          >
            ← 创作台
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-7 py-8">
        {/* tab chips */}
        <nav className="mb-8 flex flex-wrap gap-2.5" aria-label="控制台分区">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                title={`切换到「${t.label}」分区`}
                className={`cursor-pointer rounded-full border-2 border-ink px-5 py-2 text-[14px] font-bold transition-all ${
                  active ? "bg-ink text-paper" : "bg-paper text-ink hover:bg-sand"
                }`}
                style={active ? { boxShadow: `4px 4px 0 ${t.color}` } : undefined}
              >
                {t.label}
                <span
                  className={`ml-2 font-grotesk text-[10px] font-bold tracking-[1.5px] ${
                    active ? "text-tan-light" : "text-stone"
                  }`}
                >
                  {t.en}
                </span>
              </button>
            );
          })}
        </nav>

        {tab === "agents" ? (
          <AgentsSection
            agents={agents}
            models={models}
            loading={agentsLoading || modelsLoading}
            busyIds={busyAgentIds}
            onPatch={(id, patch) => void patchAgent(id, patch)}
            onOpenPrompts={setDrawerAgentId}
          />
        ) : tab === "models" ? (
          <ModelsSection models={models} loading={modelsLoading} onRefresh={loadModels} />
        ) : tab === "skills" ? (
          <SkillsSection />
        ) : (
          <EvolutionSection agents={agents} onOpenPrompts={setDrawerAgentId} />
        )}
      </main>

      {drawerAgent ? (
        <PromptDrawer
          agent={drawerAgent}
          onClose={() => setDrawerAgentId(null)}
          onChanged={() => void loadAgents()}
        />
      ) : null}
    </div>
  );
}
