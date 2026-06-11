"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/components/hooks/useSession";
import { BurstStar } from "@/components/shared/BurstStar";
import { LogoMark } from "@/components/shared/LogoMark";
import { Tip } from "@/components/shared/Tip";
import type { UsageBucket, UsageReport } from "@/lib/api-types";
import { api, ApiClientError } from "@/lib/client-api";

/* ===== static config ===== */

type Scope = UsageReport["scope"];

const SCOPES: { id: Scope; label: string; tip: string }[] = [
  { id: "task", label: "按任务", tip: "按单个任务汇总调用、tokens 与成本" },
  { id: "daily", label: "按日", tip: "按自然日汇总最近一段时间的用量" },
  { id: "weekly", label: "按周", tip: "按 ISO 周汇总，看长期成本趋势" },
];

const DAILY_RANGES = [
  { days: 7, label: "7 天", tip: "最近 7 天，按日分桶" },
  { days: 14, label: "14 天", tip: "最近 14 天，按日分桶" },
  { days: 30, label: "30 天", tip: "最近 30 天，按日分桶" },
] as const;

const WEEKLY_RANGES = [
  { days: 28, label: "4 周", tip: "最近 4 周（28 天），按 ISO 周分桶" },
  { days: 56, label: "8 周", tip: "最近 8 周（56 天），按 ISO 周分桶" },
  { days: 84, label: "12 周", tip: "最近 12 周（84 天），按 ISO 周分桶" },
] as const;

type AdminMode = "self" | "all" | "user";

const ADMIN_MODES: { id: AdminMode; label: string; tip: string }[] = [
  { id: "self", label: "仅自己", tip: "只统计自己账号的用量" },
  { id: "all", label: "全部用户", tip: "汇总平台所有用户的用量" },
  { id: "user", label: "指定用户", tip: "输入某个用户 ID，单独查看其用量" },
];

/** agents.id → 中文名册（七嘴八舌内容部）；未登记的 id 回退为原始 id 展示。 */
const AGENT_NAMES: Record<string, { name: string; role: string }> = {
  brief_assistant: { name: "灰灰", role: "简报管家" },
  searcher: { name: "搜罗", role: "情报搜集官" },
  "promptsmith:text": { name: "文枢", role: "文案提示词工程师" },
  "promptsmith:image": { name: "画引", role: "图像提示词工程师" },
  "promptsmith:video": { name: "镜语", role: "视频提示词工程师" },
  "crafter:xhs": { name: "桃桃", role: "小红书撰稿" },
  "crafter:dy": { name: "阿飞", role: "抖音撰稿" },
  "crafter:mp": { name: "文叔", role: "公众号撰稿" },
  "crafter:wb": { name: "薇薇", role: "微博撰稿" },
  "crafter:zh": { name: "谨言", role: "知乎撰稿" },
  "crafter:bjh": { name: "百晓", role: "百家号撰稿" },
  "crafter:csdn": { name: "码哥", role: "CSDN 撰稿" },
  organizer: { name: "理整", role: "结构整理师" },
  critic: { name: "老辣", role: "毒舌评审" },
  reviewer: { name: "总编", role: "总编复核" },
  reeditor: { name: "回炉", role: "重写编辑" },
  finalizer: { name: "定稿", role: "交付官" },
  extractor: { name: "拆件", role: "多模态文件解析" },
  image_director: { name: "选模", role: "图像模型路由" },
  reflector: { name: "复盘", role: "自进化分析师" },
};

/* ===== formatting helpers ===== */

const intFmt = new Intl.NumberFormat("zh-CN");
const fmtInt = (n: number) => intFmt.format(n);
/** 表格成本统一 6 位小数（与 llm_calls 流水精度一致）。 */
const fmtCost = (n: number) => `$${n.toFixed(6)}`;
const fmtCostShort = (n: number) => `$${n.toFixed(4)}`;
const fmtCostHero = (n: number) => (n >= 100 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);
const fmtTokensCompact = (n: number) =>
  n >= 10000 ? `${(n / 10000).toFixed(1)}万` : fmtInt(n);

/* ===== shared bits ===== */

/** 黄色「?」角标：悬停 / 聚焦弹出说明。 */
function InfoDot({ tip }: { tip: string }) {
  return (
    <Tip tip={tip}>
      <span
        tabIndex={0}
        className="flex h-5 w-5 cursor-help select-none items-center justify-center rounded-full border-[1.5px] border-ink bg-sun font-grotesk text-[10px] font-bold leading-none text-ink"
      >
        ?
      </span>
    </Tip>
  );
}

function SectionHead({ title, en }: { title: string; en: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="font-display text-[24px] font-normal leading-[1.3]">{title}</h2>
      <span className="font-grotesk text-[11px] font-bold tracking-[2px] text-stone">
        {en}
      </span>
    </div>
  );
}

const TH = "px-4 py-3 font-grotesk text-[11px] font-bold tracking-[1.5px] text-stone";
const NUM_TD = "px-4 py-3.5 text-right font-archivo text-[13px]";

/* ===== dashboard ===== */

/**
 * /usage 用量与成本看板：范围切换（按任务 / 按日 / 按周）+ 管理员用户筛选，
 * 渲染 UsageReport —— 总览卡、CSS 横向柱状图 / 任务明细表、按智能体与按模型分摊。
 * 页面可见时每 30 秒自动刷新。
 */
export function UsageDashboard() {
  const { user } = useSession();
  const isAdmin = user?.role === "admin";

  const [scope, setScope] = useState<Scope>("task");
  const [dailyDays, setDailyDays] = useState<number>(7);
  const [weeklyDays, setWeeklyDays] = useState<number>(28);
  const [adminMode, setAdminMode] = useState<AdminMode>("self");
  const [userIdInput, setUserIdInput] = useState("");
  const [appliedUserId, setAppliedUserId] = useState("");

  const [report, setReport] = useState<UsageReport | null>(null);
  /** 最近一次成功 / 失败落地的查询串；与当前 query 不一致即视为加载中。 */
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const fetchSeq = useRef(0);

  const query = useMemo(() => {
    const params = new URLSearchParams({ scope });
    if (scope === "daily") params.set("days", String(dailyDays));
    if (scope === "weekly") params.set("days", String(weeklyDays));
    if (isAdmin && adminMode === "all") params.set("all", "1");
    if (isAdmin && adminMode === "user" && appliedUserId)
      params.set("userId", appliedUserId);
    return params.toString();
  }, [scope, dailyDays, weeklyDays, isAdmin, adminMode, appliedUserId]);

  const loading = loadedQuery !== query;

  // 注意：本函数在首个 await 之前不调用任何 setState（effect 中直接调用也安全）。
  const load = useCallback(
    async (silent: boolean) => {
      const seq = ++fetchSeq.current;
      try {
        const data = await api.get<UsageReport>(`/api/usage?${query}`);
        if (seq !== fetchSeq.current) return; // 已被更新的请求取代
        setReport(data);
        setError(null);
        setUpdatedAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          window.location.href = "/login?next=/usage";
          return;
        }
        if (seq !== fetchSeq.current) return;
        setError(err instanceof Error ? err.message : "加载失败，请稍后重试");
        if (!silent) setReport(null);
      } finally {
        if (seq === fetchSeq.current) {
          setLoadedQuery(query);
          setRefreshing(false);
        }
      }
    },
    [query],
  );

  /** 静默刷新：保留当前画面，仅右上角显示「刷新中…」。 */
  const silentRefresh = useCallback(() => {
    setRefreshing(true);
    void load(true);
  }, [load]);

  useEffect(() => {
    void (async () => {
      await load(false);
    })();
  }, [load]);

  // 页面可见时每 30 秒自动刷新；切回标签页时立即刷新一次。
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") silentRefresh();
    };
    const timer = window.setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [silentRefresh]);

  const empty = report !== null && report.totals.calls === 0;
  const filtered = isAdmin && adminMode !== "self";

  return (
    <div className="min-h-dvh bg-cream">
      {/* Topbar */}
      <header className="sticky top-0 z-40 border-b-2 border-ink bg-paper">
        <div className="mx-auto flex max-w-[1160px] items-center justify-between px-6 py-4 lg:px-10">
          <Link href="/" title="返回首页" className="flex items-center gap-2.5">
            <LogoMark size={22} />
            <span className="font-display text-[21px] font-normal leading-none">
              灰灰营销
            </span>
            <span className="font-grotesk text-[11px] font-bold tracking-[2px] text-stone">
              USAGE
            </span>
          </Link>
          {/* 顶栏贴住视口顶部，Tip 气泡向上弹会被裁切，这里用原生 title */}
          <Link
            href="/studio"
            title="回到创作台继续生成内容"
            className="inline-block rounded-full bg-ink px-[18px] py-2 text-[13px] font-bold text-paper shadow-[3px_3px_0_#FF4B2E]"
          >
            ← 返回创作台
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1160px] px-6 py-10 lg:px-10">
        {/* Page head */}
        <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-display text-[40px] font-normal leading-[1.15]">
                用量与成本
              </h1>
              <BurstStar size={28} fill="#FFC53D" className="animate-spin-slow" />
            </div>
            <p className="mt-2 max-w-[560px] text-[14px] leading-[1.8] text-soot">
              每一次 AI 调用都记账在册：按任务、按日、按周三种口径，核对调用次数、tokens
              与成本。
            </p>
          </div>
          <span className="font-grotesk text-[13px] font-bold tracking-[3px] text-stone">
            USAGE &amp; COST
          </span>
        </div>

        {/* Controls */}
        <section className="mb-6 rounded-[18px] border-2 border-ink bg-paper px-5 py-4 shadow-[6px_6px_0_#17130C]">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="mr-0.5 font-grotesk text-[11px] font-bold tracking-[2px] text-stone">
              SCOPE
            </span>
            {SCOPES.map((s) => {
              const active = scope === s.id;
              return (
                <Tip key={s.id} tip={s.tip}>
                  <button
                    type="button"
                    onClick={() => setScope(s.id)}
                    className={`cursor-pointer rounded-full border-[1.5px] border-ink px-4 py-1.5 text-[13px] font-bold transition-colors ${
                      active
                        ? "bg-ink text-paper shadow-[3px_3px_0_#FFC53D]"
                        : "bg-paper text-soot hover:bg-cream"
                    }`}
                  >
                    {s.label}
                  </button>
                </Tip>
              );
            })}

            {scope !== "task" && (
              <>
                <span className="mx-1 h-5 w-[2px] rounded bg-tan" aria-hidden />
                <span className="mr-0.5 font-grotesk text-[11px] font-bold tracking-[2px] text-stone">
                  RANGE
                </span>
                {(scope === "daily" ? DAILY_RANGES : WEEKLY_RANGES).map((r) => {
                  const current = scope === "daily" ? dailyDays : weeklyDays;
                  const active = current === r.days;
                  return (
                    <Tip key={r.days} tip={r.tip}>
                      <button
                        type="button"
                        onClick={() =>
                          scope === "daily"
                            ? setDailyDays(r.days)
                            : setWeeklyDays(r.days)
                        }
                        className={`cursor-pointer rounded-full border-[1.5px] border-ink px-3 py-1 text-[12px] font-bold transition-colors ${
                          active
                            ? "bg-klein text-paper shadow-[2px_2px_0_#17130C]"
                            : "bg-paper text-soot hover:bg-cream"
                        }`}
                      >
                        {r.label}
                      </button>
                    </Tip>
                  );
                })}
              </>
            )}

            <div className="ml-auto flex flex-wrap items-center gap-2.5">
              {error && report && (
                <span
                  title={error}
                  className="rounded-full border-[1.5px] border-poppy px-3 py-0.5 text-[11px] font-bold text-poppy"
                >
                  刷新失败，显示上次数据
                </span>
              )}
              <Tip tip="页面可见时每 30 秒自动拉取最新用量">
                <span tabIndex={0} className="cursor-help text-[12px] text-stone">
                  {refreshing
                    ? "刷新中…"
                    : updatedAt
                      ? `每 30 秒自动刷新 · 更新于 ${updatedAt}`
                      : "每 30 秒自动刷新"}
                </span>
              </Tip>
              <Tip tip="立即重新拉取用量数据">
                <button
                  type="button"
                  onClick={silentRefresh}
                  className="cursor-pointer rounded-full border-[1.5px] border-ink bg-paper px-3.5 py-1 text-[12px] font-bold transition-colors hover:bg-sun"
                >
                  ↻ 刷新
                </button>
              </Tip>
            </div>
          </div>
        </section>

        {/* Admin: user filter */}
        {isAdmin && (
          <section className="mb-6 rounded-[18px] border-2 border-ink bg-ink px-5 py-4 shadow-[4px_4px_0_#2849F4]">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="rounded-full border-[1.5px] border-ink bg-sun px-2.5 py-0.5 font-grotesk text-[10px] font-bold tracking-[1.5px] text-ink">
                ADMIN
              </span>
              <span className="text-[13px] font-bold text-paper">统计范围</span>
              {ADMIN_MODES.map((m) => {
                const active = adminMode === m.id;
                return (
                  <Tip key={m.id} tip={m.tip}>
                    <button
                      type="button"
                      onClick={() => setAdminMode(m.id)}
                      className={`cursor-pointer rounded-full border-[1.5px] px-3.5 py-1 text-[12px] font-bold transition-colors ${
                        active
                          ? "border-sun bg-sun text-ink"
                          : "border-[rgba(255,253,247,.3)] bg-transparent text-tan-dark hover:text-paper"
                      }`}
                    >
                      {m.label}
                    </button>
                  </Tip>
                );
              })}
              {adminMode === "user" && (
                <>
                  <input
                    value={userIdInput}
                    onChange={(e) => setUserIdInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setAppliedUserId(userIdInput.trim());
                    }}
                    placeholder="输入用户 ID"
                    title="输入要查询的用户 ID，回车或点「应用」生效"
                    className="w-[220px] rounded-full border-[1.5px] border-[rgba(255,253,247,.3)] bg-transparent px-4 py-1.5 text-[13px] text-paper outline-none placeholder:text-stone focus:border-sun"
                  />
                  <Tip tip="按该用户 ID 查询其用量">
                    <button
                      type="button"
                      onClick={() => setAppliedUserId(userIdInput.trim())}
                      className="cursor-pointer rounded-full border-[1.5px] border-sun bg-sun px-3.5 py-1 text-[12px] font-bold text-ink"
                    >
                      应用
                    </button>
                  </Tip>
                  {appliedUserId ? (
                    <span className="rounded-full border border-[rgba(255,253,247,.3)] px-3 py-0.5 font-mono text-[11px] text-sun">
                      正在查看：{appliedUserId}
                    </span>
                  ) : (
                    <span className="text-[12px] text-stone">
                      输入用户 ID 后点「应用」，留空则查看自己
                    </span>
                  )}
                </>
              )}
            </div>
          </section>
        )}

        {/* Body */}
        {loading ? (
          <section className="rounded-[18px] border-2 border-ink bg-paper px-8 py-20 text-center shadow-[6px_6px_0_#17130C]">
            <div className="font-display text-[20px] font-normal">正在统计用量…</div>
            <div className="mt-2 font-grotesk text-[11px] font-bold tracking-[2px] text-stone">
              CRUNCHING NUMBERS<span className="animate-blink">…</span>
            </div>
          </section>
        ) : error && !report ? (
          <section className="rounded-[18px] border-2 border-ink bg-paper px-8 py-16 text-center shadow-[6px_6px_0_#FF4B2E]">
            <div className="text-[18px] font-black text-poppy">用量加载失败</div>
            <p className="mt-2 text-[13.5px] leading-[1.8] text-soot">{error}</p>
            <Tip tip="重新请求一次用量数据">
              <button
                type="button"
                onClick={() => void load(false)}
                className="mt-5 cursor-pointer rounded-full border-2 border-ink bg-sun px-6 py-2.5 text-[14px] font-bold shadow-[3px_3px_0_#17130C]"
              >
                ↺ 重试
              </button>
            </Tip>
          </section>
        ) : report ? (
          empty ? (
            <EmptyState filtered={filtered} />
          ) : (
            <>
              <HeroCards report={report} scope={scope} />
              {scope === "task" ? (
                <TaskTable buckets={report.buckets} />
              ) : (
                <BucketChart scope={scope} buckets={report.buckets} />
              )}
              <section className="mb-8">
                <SectionHead title="成本分摊" en="BY AGENT / BY MODEL" />
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <AgentTable rows={report.byAgent} />
                  <ModelTable rows={report.byModel} />
                </div>
              </section>
            </>
          )
        ) : null}
      </main>
    </div>
  );
}

/* ===== sections ===== */

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <section className="rounded-[18px] border-2 border-ink bg-paper px-8 py-16 text-center shadow-[6px_6px_0_#17130C]">
      <div className="relative mx-auto h-[120px] w-[120px]">
        <BurstStar size={120} fill="#FFC53D" />
        <div className="absolute inset-0 flex items-center justify-center font-display text-[22px] font-normal text-ink">
          用量
        </div>
      </div>
      <div className="mt-5 text-[18px] font-black">
        {filtered ? "该范围内还没有用量记录" : "还没有用量"}
      </div>
      <p className="mx-auto mt-2 max-w-[430px] text-[13.5px] leading-[1.9] text-soot">
        {filtered
          ? "试试切换统计口径、放宽时间范围，或换一个用户 ID 再查询。"
          : "去创作台发起第一个任务，专家团开工后，这里会按任务、按日、按周记下每一笔调用与成本。"}
      </p>
      {!filtered && (
        <Link
          href="/studio"
          title="前往创作台发起第一个任务"
          className="mt-6 inline-block rounded-full bg-ink px-6 py-3 text-[14.5px] font-bold text-paper shadow-[4px_4px_0_#FF4B2E]"
        >
          去创作台发起第一个任务 →
        </Link>
      )}
      <div className="mt-5 font-grotesk text-[10px] font-bold tracking-[2px] text-stone">
        NO USAGE YET
      </div>
    </section>
  );
}

function HeroCards({ report, scope }: { report: UsageReport; scope: Scope }) {
  const t = report.totals;
  const bucketNoun = scope === "task" ? "个任务" : scope === "daily" ? "天" : "周";
  const cards = [
    {
      en: "TOTAL COST",
      label: "总成本（美元）",
      value: fmtCostHero(t.costUsd),
      strip: "bg-poppy",
      numClass: "text-poppy",
      sub: `跨 ${fmtInt(report.buckets.length)} ${bucketNoun}累计`,
      tip: "计费 = tokens × 模型单价（USD），逐笔记入 llm_calls 流水；失败与回退调用同样计费",
    },
    {
      en: "TOTAL TOKENS",
      label: "总 tokens",
      value: fmtInt(t.promptTokens + t.completionTokens),
      strip: "bg-klein",
      numClass: "text-klein",
      sub: `提示 ${fmtInt(t.promptTokens)} · 生成 ${fmtInt(t.completionTokens)}`,
      tip: "提示（输入）与生成（输出）tokens 之和；模型未返回用量时按字符数 ÷ 4 估算",
    },
    {
      en: "LLM CALLS",
      label: "调用次数",
      value: fmtInt(t.calls),
      strip: "bg-jade",
      numClass: "text-jade",
      sub: "含成功、失败与回退调用",
      tip: "每次 LLM 调用（成功或失败）记一笔；触发回退模型时回退调用单独再记一笔",
    },
  ];
  return (
    <div className="mb-8 grid grid-cols-1 gap-5 md:grid-cols-3">
      {cards.map((c) => (
        <div
          key={c.en}
          className="overflow-hidden rounded-[18px] border-2 border-ink bg-paper shadow-[6px_6px_0_#17130C]"
        >
          <div className={`h-[10px] ${c.strip}`} />
          <div className="p-6">
            <div className="flex items-center justify-between">
              <span className="font-grotesk text-[11px] font-bold tracking-[2px] text-stone">
                {c.en}
              </span>
              <InfoDot tip={c.tip} />
            </div>
            <div className={`mt-2 font-archivo text-[34px] leading-[1.2] ${c.numClass}`}>
              {c.value}
            </div>
            <div className="mt-1 text-[14px] font-bold">{c.label}</div>
            <div className="mt-1 text-[12px] text-stone">{c.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** 按日 / 按周横向柱状图：宽度按窗口内最大值归一化；全零成本时回退按 tokens 归一化。 */
function BucketChart({ scope, buckets }: { scope: Scope; buckets: UsageBucket[] }) {
  const byCost = buckets.some((b) => b.costUsd > 0);
  const metric = (b: UsageBucket) =>
    byCost ? b.costUsd : b.promptTokens + b.completionTokens;
  const max = buckets.reduce((m, b) => Math.max(m, metric(b)), 0);

  return (
    <section className="mb-8">
      <SectionHead
        title={scope === "daily" ? "每日成本" : "每周成本"}
        en={scope === "daily" ? "DAILY BREAKDOWN" : "WEEKLY BREAKDOWN"}
      />
      <div className="rounded-[18px] border-2 border-ink bg-ink p-6 shadow-[4px_4px_0_#FF4B2E]">
        <div className="flex flex-col gap-2.5">
          {buckets.map((b) => {
            const v = metric(b);
            const pct = max > 0 ? (v / max) * 100 : 0;
            const tokens = b.promptTokens + b.completionTokens;
            return (
              <div
                key={b.key}
                title={`${b.label} · 调用 ${fmtInt(b.calls)} 次 · ${fmtInt(tokens)} tokens · ${fmtCost(b.costUsd)}`}
                className="group flex cursor-default items-center gap-3"
              >
                <div className="w-[88px] shrink-0 truncate text-right font-grotesk text-[11px] font-bold tracking-[0.5px] text-tan-dark">
                  {b.label}
                </div>
                <div className="h-6 min-w-0 flex-1">
                  {v > 0 ? (
                    <div
                      className="h-full rounded-[5px] bg-klein transition-colors group-hover:bg-sun"
                      style={{ width: `${Math.max(pct, 1.25)}%` }}
                    />
                  ) : (
                    <div className="h-full w-[2px] rounded bg-[rgba(255,253,247,.28)]" />
                  )}
                </div>
                <div className="w-[140px] shrink-0 text-right">
                  <span className="font-archivo text-[12px] text-paper transition-colors group-hover:text-sun">
                    {byCost ? fmtCostShort(b.costUsd) : `${fmtTokensCompact(tokens)} tokens`}
                  </span>
                  <span className="ml-2 text-[11px] text-stone">{fmtInt(b.calls)} 次</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[rgba(255,253,247,.14)] pt-3">
          <span className="text-[11px] text-stone">
            柱长按{byCost ? "成本" : " tokens "}归一化 · 零用量时段显示为细线 ·
            悬停查看明细
          </span>
          {!byCost && (
            <Tip tip="当前窗口内所有调用成本为 0（例如测试 / 模拟模式零计费），柱长改按 tokens 归一化展示">
              <span
                tabIndex={0}
                className="cursor-help rounded-full border border-[rgba(255,253,247,.3)] px-2.5 py-0.5 font-grotesk text-[10px] font-bold tracking-[1px] text-sun"
              >
                ZERO-COST FALLBACK
              </span>
            </Tip>
          )}
        </div>
      </div>
    </section>
  );
}

function TaskTable({ buckets }: { buckets: UsageBucket[] }) {
  return (
    <section className="mb-8">
      <SectionHead title="任务用量明细" en="BY TASK" />
      <div className="overflow-hidden rounded-[18px] border-2 border-ink bg-paper shadow-[6px_6px_0_#17130C]">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b-2 border-ink bg-cream">
                <th className={`${TH} pl-5`}>任务 TASK</th>
                <th className={`${TH} text-right`}>调用 CALLS</th>
                <th className={`${TH} text-right`}>TOKENS</th>
                <th className={`${TH} text-right`}>成本 COST</th>
                <th className={`${TH} pr-5 text-right`}>操作</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr
                  key={b.key}
                  className="border-t border-tan-light transition-colors hover:bg-cream"
                >
                  <td className="max-w-[320px] py-3.5 pl-5 pr-4">
                    <div className="truncate text-[14px] font-bold" title={b.label}>
                      {b.label || "未命名任务"}
                    </div>
                    <div className="truncate font-mono text-[11px] text-stone">
                      {b.key}
                    </div>
                  </td>
                  <td className={NUM_TD}>{fmtInt(b.calls)}</td>
                  <td className={NUM_TD}>
                    {fmtInt(b.promptTokens + b.completionTokens)}
                  </td>
                  <td className={`${NUM_TD} text-poppy`}>{fmtCost(b.costUsd)}</td>
                  <td className="py-3.5 pl-4 pr-5 text-right">
                    <Tip tip="在创作台打开该任务，查看结果与对话">
                      <Link
                        href={`/studio?task=${encodeURIComponent(b.key)}`}
                        className="inline-block whitespace-nowrap rounded-full border-[1.5px] border-ink bg-paper px-3.5 py-1 text-[12px] font-bold transition-colors hover:bg-sun"
                      >
                        打开 →
                      </Link>
                    </Tip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function AgentTable({ rows }: { rows: UsageReport["byAgent"] }) {
  const sorted = [...rows].sort((a, b) => b.costUsd - a.costUsd);
  const hasUnknown = sorted.some((r) => !AGENT_NAMES[r.agentId]);
  return (
    <div className="self-start overflow-hidden rounded-[18px] border-2 border-ink bg-paper shadow-[6px_6px_0_#17130C]">
      <div className="flex items-center justify-between border-b-2 border-ink bg-sun px-5 py-3">
        <span className="text-[15px] font-black">按智能体分摊</span>
        <span className="font-grotesk text-[10px] font-bold tracking-[2px] text-soot">
          BY AGENT
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="bg-cream">
              <th className={`${TH} pl-5`}>智能体</th>
              <th className={`${TH} text-right`}>调用</th>
              <th className={`${TH} text-right`}>TOKENS</th>
              <th className={`${TH} pr-5 text-right`}>成本</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr className="border-t border-tan-light">
                <td colSpan={4} className="px-5 py-6 text-center text-[13px] text-stone">
                  暂无分摊数据
                </td>
              </tr>
            ) : (
              sorted.map((r) => {
                const known = AGENT_NAMES[r.agentId];
                return (
                  <tr
                    key={r.agentId}
                    className="border-t border-tan-light transition-colors hover:bg-cream"
                  >
                    <td className="max-w-[220px] py-3 pl-5 pr-4">
                      {known ? (
                        <>
                          <span className="text-[14px] font-bold">{known.name}</span>
                          <span className="ml-2 text-[12px] text-soot">{known.role}</span>
                          <div className="truncate font-mono text-[11px] text-stone">
                            {r.agentId}
                          </div>
                        </>
                      ) : (
                        <span
                          className="font-mono text-[13px] font-bold"
                          title="未登记的智能体，按原始 ID 显示"
                        >
                          {r.agentId} *
                        </span>
                      )}
                    </td>
                    <td className={NUM_TD}>{fmtInt(r.calls)}</td>
                    <td className={NUM_TD}>
                      {fmtInt(r.promptTokens + r.completionTokens)}
                    </td>
                    <td className={`${NUM_TD} pr-5 text-poppy`}>{fmtCost(r.costUsd)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {hasUnknown && (
        <div className="border-t border-tan-light px-5 py-2.5">
          <Tip tip="智能体名册来自系统预置清单（七嘴八舌内容部）；新增或自定义的智能体在登记前按原始 ID 展示">
            <span tabIndex={0} className="cursor-help text-[11px] text-stone">
              * 未识别的智能体按原始 ID 显示
            </span>
          </Tip>
        </div>
      )}
    </div>
  );
}

function ModelTable({ rows }: { rows: UsageReport["byModel"] }) {
  const sorted = [...rows].sort((a, b) => b.costUsd - a.costUsd);
  return (
    <div className="self-start overflow-hidden rounded-[18px] border-2 border-ink bg-paper shadow-[6px_6px_0_#17130C]">
      <div className="flex items-center justify-between border-b-2 border-ink bg-mist px-5 py-3">
        <span className="text-[15px] font-black">按模型分摊</span>
        <span className="font-grotesk text-[10px] font-bold tracking-[2px] text-soot">
          BY MODEL
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="bg-cream">
              <th className={`${TH} pl-5`}>模型</th>
              <th className={`${TH} text-right`}>调用</th>
              <th className={`${TH} text-right`}>TOKENS</th>
              <th className={`${TH} pr-5 text-right`}>成本</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr className="border-t border-tan-light">
                <td colSpan={4} className="px-5 py-6 text-center text-[13px] text-stone">
                  暂无分摊数据
                </td>
              </tr>
            ) : (
              sorted.map((r) => (
                <tr
                  key={r.modelId}
                  className="border-t border-tan-light transition-colors hover:bg-cream"
                >
                  <td
                    className="max-w-[220px] truncate py-3 pl-5 pr-4 font-mono text-[13px]"
                    title={r.modelId}
                  >
                    {r.modelId}
                  </td>
                  <td className={NUM_TD}>{fmtInt(r.calls)}</td>
                  <td className={NUM_TD}>
                    {fmtInt(r.promptTokens + r.completionTokens)}
                  </td>
                  <td className={`${NUM_TD} pr-5 text-poppy`}>{fmtCost(r.costUsd)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
