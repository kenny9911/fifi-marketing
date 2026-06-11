"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/components/hooks/useSession";
import { useWorkbench } from "@/components/hooks/useWorkbench";
import { CoachMarks } from "@/components/shared/CoachMarks";
import { LogoMark } from "@/components/shared/LogoMark";
import { Tip } from "@/components/shared/Tip";
import { BriefIntake } from "@/components/workbench/BriefIntake";
import { CostChip } from "@/components/workbench/CostChip";
import { ResultsDeck } from "@/components/workbench/ResultsDeck";
import { SessionsSidebar } from "@/components/workbench/SessionsSidebar";
import { StageTracker } from "@/components/workbench/StageTracker";
import { TaskChat } from "@/components/workbench/TaskChat";
import { ThinkingTimeline } from "@/components/workbench/ThinkingTimeline";
import { Toasts, useToasts } from "@/components/workbench/Toasts";
import type {
  ChatMessageDto,
  TaskBrief,
  TaskEventDto,
  TaskStatus,
  UsageTotals,
  UserDto,
} from "@/lib/api-types";
import { ApiClientError } from "@/lib/client-api";
import type { PlatformId } from "@/lib/types";

/** First-visit guided hints: 新建任务 → 填简报 → 看专家思考 → 收稿微调. */
const COACH_STEPS = [
  {
    target: '[data-coach="sidebar"]',
    title: "新建任务",
    body: "所有创作任务都在这里。点「新建任务」开稿，历史任务随时点开继续。",
  },
  {
    target: '[data-coach="brief"]',
    title: "填好简报",
    body: "告诉灰灰目标、受众、平台和素材，越具体出稿越准，还能附上文件。",
  },
  {
    target: '[data-coach="timeline"]',
    title: "看专家思考",
    body: "开稿后专家团的每一步思考、搜索与评审都会实时出现在这条时间线。",
  },
  {
    target: '[data-coach="results"]',
    title: "收稿微调",
    body: "定稿按平台分卡展示。想改哪里？在对话里说一句，专家就会回炉微调。",
  },
];

/**
 * The studio workbench shell: owns useSession + useWorkbench, lays out
 * topbar / sessions sidebar / center (brief intake or task chat) / flight
 * deck (stage tracker + thinking timeline + results deck), and the toast
 * stack. All children are imported by contract.
 *
 * `initialTaskId` supports deep links like /studio?task=<id> (e.g. from the
 * usage dashboard): the task is loaded once on mount.
 */
export function WorkbenchShell({ initialTaskId }: { initialTaskId?: string }) {
  const { user, loading: sessionLoading, logout } = useSession();
  const wb = useWorkbench();
  const { current, stream } = wb;
  const { toasts, push, dismiss } = useToasts();

  const [launching, setLaunching] = useState(false);
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [taskLoading, setTaskLoading] = useState(false);

  // The proxy gates /studio, but the cookie can expire while the tab is open.
  useEffect(() => {
    if (!sessionLoading && !user) {
      window.location.href = "/login?next=/studio";
    }
  }, [sessionLoading, user]);

  // Deep link (/studio?task=<id>): open the requested task once on mount.
  const { load: wbLoad } = wb;
  const bootedTaskRef = useRef(false);
  useEffect(() => {
    if (!initialTaskId || bootedTaskRef.current) return;
    bootedTaskRef.current = true;
    setTaskLoading(true);
    void wbLoad(initialTaskId)
      .catch((e) => fail(e, "任务加载失败，请从左侧任务列表重新打开"))
      .finally(() => setTaskLoading(false));
    // fail/push are stable enough for a once-per-mount effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTaskId, wbLoad]);

  /** Toast an action failure; a 401 means the session died → back to login. */
  function fail(e: unknown, fallback: string) {
    if (e instanceof ApiClientError && e.status === 401) {
      window.location.href = "/login?next=/studio";
      return;
    }
    push(e instanceof ApiClientError && e.message ? e.message : fallback, "error");
  }

  // Live values: the SSE stream wins while it has data, detail is the fallback.
  const effStatus: TaskStatus | null = stream.status ?? current?.status ?? null;
  const effStage = stream.stage ?? current?.stage ?? null;
  const isRunning = effStatus === "running";

  const mergedEvents = useMemo<TaskEventDto[]>(() => {
    const bySeq = new Map<number, TaskEventDto>();
    for (const ev of current?.events ?? []) bySeq.set(ev.seq, ev);
    for (const ev of stream.events) bySeq.set(ev.seq, ev);
    return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  }, [current?.events, stream.events]);

  const mergedMessages = useMemo<ChatMessageDto[]>(() => {
    const byId = new Map<string, ChatMessageDto>();
    for (const m of current?.messages ?? []) byId.set(m.id, m);
    for (const m of stream.messages) if (!byId.has(m.id)) byId.set(m.id, m);
    return [...byId.values()].sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
    );
  }, [current?.messages, stream.messages]);

  const hasFinals = Boolean(current && Object.keys(current.finals).length > 0);
  /** Finals already exist but the pipeline is active again → a revision run. */
  const revisionInFlight = hasFinals && (isRunning || effStatus === "reviewing");

  // Topbar cost chip: live stream usage while running, else the task's stored
  // cost. TaskDetail only has aggregate tokens — fold them into promptTokens
  // so the total stays right.
  const chipUsage: UsageTotals | null = useMemo(() => {
    if (isRunning && stream.liveUsage) return stream.liveUsage;
    if (!current) return null;
    return {
      calls: 0,
      promptTokens: current.tokens,
      completionTokens: 0,
      costUsd: current.costUsd,
    };
  }, [isRunning, stream.liveUsage, current]);

  // ===== Actions (all toast on failure) =====

  async function handleLaunch(brief: TaskBrief) {
    setLaunching(true);
    try {
      await wb.create(brief);
      await wb.start();
    } catch (e) {
      fail(e, "任务创建失败，请稍后重试");
    } finally {
      setLaunching(false);
    }
  }

  async function handleStart() {
    setStarting(true);
    try {
      await wb.start();
    } catch (e) {
      fail(e, "启动失败，请检查简报后重试");
    } finally {
      setStarting(false);
    }
  }

  async function handleSend(text: string) {
    setSending(true);
    try {
      await wb.send(text);
    } catch (e) {
      fail(e, "消息发送失败，请重试");
    } finally {
      setSending(false);
    }
  }

  async function handleCancel() {
    try {
      await wb.cancel();
      push("任务已取消，已产出的内容已保留", "info");
    } catch (e) {
      fail(e, "取消失败，请重试");
    }
  }

  async function handleSelect(id: string) {
    if (current?.id === id) return;
    setTaskLoading(true);
    try {
      await wb.load(id);
    } catch (e) {
      fail(e, "任务加载失败，请重试");
    } finally {
      setTaskLoading(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await wb.remove(id);
      push("任务已删除", "success");
    } catch (e) {
      fail(e, "删除失败，请重试");
    }
  }

  async function handleUpload(file: File) {
    try {
      await wb.uploadFile(file);
    } catch (e) {
      fail(e, "文件上传失败，请重试");
    }
  }

  async function handleGenerateImage(platform: PlatformId) {
    setImageBusy(true);
    try {
      await wb.generateImage(platform);
      push("配图已生成，见结果卡片", "success");
    } catch (e) {
      fail(e, "配图生成失败，请稍后重试");
    } finally {
      setImageBusy(false);
    }
  }

  function handleNew() {
    wb.closeTask();
  }

  async function handleLogout() {
    try {
      await logout();
    } catch {
      // 即便接口失败也回到登录页，cookie 已不可信
    }
    window.location.href = "/login";
  }

  const showRight = Boolean(current) || taskLoading;
  const gridCols = showRight
    ? "lg:grid-cols-[250px_minmax(0,1fr)_420px] xl:grid-cols-[270px_minmax(0,1fr)_500px]"
    : "lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[270px_minmax(0,1fr)]";

  return (
    <div className="flex h-dvh flex-col bg-paper">
      {/* ===== Topbar ===== */}
      <header className="flex shrink-0 items-center justify-between gap-4 border-b-2 border-ink bg-cream px-5 py-3.5 lg:px-7">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link href="/" title="返回首页" className="flex shrink-0 items-center gap-2.5">
            <LogoMark size={22} />
            <span className="font-display text-[21px] font-normal leading-none">
              灰灰创作台
            </span>
          </Link>
          <span className="hidden font-grotesk text-[11px] font-bold tracking-[2px] text-stone sm:inline">
            STUDIO
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {chipUsage && <CostChip usage={chipUsage} live={isRunning} />}
          {sessionLoading ? (
            <div className="h-9 w-28 animate-pulse rounded-full bg-sand" />
          ) : user ? (
            <UserMenu user={user} onLogout={handleLogout} />
          ) : null}
        </div>
      </header>

      {/* ===== Body: sidebar | center | flight deck. Stacks below lg. ===== */}
      <main
        className={`grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden ${gridCols}`}
      >
        {/* Sessions sidebar — horizontal scroller below lg */}
        <div
          data-coach="sidebar"
          className="min-h-0 min-w-0 border-b-2 border-ink bg-cream max-lg:overflow-x-auto lg:overflow-y-auto lg:border-b-0 lg:border-r-2"
        >
          <SessionsSidebar
            tasks={wb.tasks}
            activeId={current?.id ?? null}
            loading={wb.tasksLoading}
            onSelect={handleSelect}
            onNew={handleNew}
            onDelete={handleDelete}
          />
        </div>

        {/* Center: brief intake (no task) or task chat + status bar */}
        <section
          data-coach="brief"
          className={`flex min-h-0 min-w-0 flex-col bg-paper ${
            showRight ? "h-[70dvh] border-b-2 border-ink lg:h-auto lg:border-b-0" : ""
          }`}
        >
          {sessionLoading || taskLoading ? (
            <CenterSkeleton />
          ) : current ? (
            <>
              <div className="min-h-0 flex-1 overflow-hidden">
                <TaskChat
                  messages={mergedMessages}
                  status={effStatus ?? current.status}
                  onSend={handleSend}
                  sending={sending}
                />
              </div>
              <StatusBar
                status={effStatus ?? current.status}
                error={current.error}
                connected={stream.connected}
                starting={starting}
                onStart={handleStart}
                onCancel={handleCancel}
                onNew={handleNew}
              />
            </>
          ) : (
            <div className="min-h-0 flex-1 lg:overflow-y-auto">
              <BriefIntake
                onLaunch={handleLaunch}
                files={wb.files}
                onUpload={handleUpload}
                busy={launching}
                defaultPlatforms={user?.settings.defaultPlatforms}
              />
            </div>
          )}
        </section>

        {/* Flight deck: stage tracker + thinking timeline + results deck */}
        {showRight && (
          <aside className="scrollbar-studio flex min-h-0 min-w-0 flex-col gap-5 bg-ink px-5 py-6 lg:overflow-y-auto lg:border-l-2 lg:border-ink">
            {taskLoading || !current ? (
              <DeckSkeleton />
            ) : (
              <>
                <StageTracker stage={effStage} status={effStatus} />
                <div data-coach="timeline" className="min-w-0">
                  <ThinkingTimeline events={mergedEvents} live={isRunning} />
                </div>
                {hasFinals && (
                  <div data-coach="results" className="min-w-0">
                    <ResultsDeck
                      detail={current}
                      onGenerateImage={handleGenerateImage}
                      imageBusy={imageBusy}
                      // undefined（而非 false）让 ResultsDeck 落到事件扫描分支，
                      // 已完成/恢复的任务只要跑过 reedit 也能亮「已回炉重写」徽标
                      hasRevision={revisionInFlight || undefined}
                      onRefine={handleSend}
                      refineBusy={sending}
                    />
                  </div>
                )}
              </>
            )}
          </aside>
        )}
      </main>

      <Toasts toasts={toasts} onDismiss={dismiss} />
      {/* 新手引导受设置里的「新手提示」开关控制（SPEC §6 req 9） */}
      {!sessionLoading && user && (user.settings.hintsEnabled ?? true) && (
        <CoachMarks steps={COACH_STEPS} storageKey="fifi-coach-v1" />
      )}
    </div>
  );
}

/** displayName chip → dropdown: 设置 / 用量 / 管理(admin) / 退出登录. */
function UserMenu({ user, onLogout }: { user: UserDto; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <Tip tip="账户菜单：设置、用量与退出">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex cursor-pointer items-center gap-2 rounded-full border-[1.5px] border-ink bg-paper py-1.5 pl-1.5 pr-3.5 text-[13px] font-bold"
        >
          {user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- presigned MinIO URL, skip the image optimizer
            <img
              src={user.avatarUrl}
              alt=""
              className="h-6 w-6 rounded-full border border-ink object-cover"
            />
          ) : (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-klein font-archivo text-[11px] text-paper">
              {user.displayName.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="max-w-[120px] truncate">{user.displayName}</span>
          <span className={`text-[10px] transition-transform ${open ? "rotate-180" : ""}`}>
            ▾
          </span>
        </button>
      </Tip>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-44 overflow-hidden rounded-[14px] border-2 border-ink bg-paper shadow-[5px_5px_0_#17130C]"
        >
          <Link
            role="menuitem"
            href="/settings"
            title="个人资料与偏好设置"
            className="block px-4 py-2.5 text-[13.5px] font-medium hover:bg-cream"
          >
            设置
          </Link>
          <Link
            role="menuitem"
            href="/usage"
            title="用量与花费报表"
            className="block px-4 py-2.5 text-[13.5px] font-medium hover:bg-cream"
          >
            用量
          </Link>
          {user.role === "admin" && (
            <Link
              role="menuitem"
              href="/admin"
              title="管理后台（仅管理员可见）"
              className="block px-4 py-2.5 text-[13.5px] font-medium hover:bg-cream"
            >
              管理
            </Link>
          )}
          <button
            role="menuitem"
            type="button"
            onClick={onLogout}
            title="退出当前账号"
            className="block w-full cursor-pointer border-t-[1.5px] border-tan-light px-4 py-2.5 text-left text-[13.5px] font-bold text-poppy hover:bg-cream"
          >
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Slim bar under the chat that always tells the user the next step (req 9):
 * briefing → 开始生成；running → 进展提示 + 取消；done → 微调提示；
 * reviewing → 已交付但含残留问题，提示在对话里复核/修订；
 * failed/cancelled → 重新生成 或 新建任务重来.
 */
function StatusBar({
  status,
  error,
  connected,
  starting,
  onStart,
  onCancel,
  onNew,
}: {
  status: TaskStatus;
  error?: string;
  connected: boolean;
  starting: boolean;
  onStart: () => void;
  onCancel: () => void;
  onNew: () => void;
}) {
  if (status === "briefing") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-ink bg-cream px-6 py-3.5">
        <div className="min-w-0">
          <div className="text-[14px] font-bold">简报已就绪</div>
          <div className="text-[12.5px] text-stone">
            确认简报无误后点右侧「开始生成」，专家团立即开工
          </div>
        </div>
        <Tip tip="启动八阶段专家流水线，开始出稿">
          <button
            type="button"
            onClick={onStart}
            disabled={starting}
            className="cursor-pointer rounded-[14px] border-2 border-ink bg-poppy px-6 py-3 text-[15px] font-bold text-paper shadow-[4px_4px_0_#17130C] disabled:cursor-wait disabled:opacity-60"
          >
            {starting ? "启动中…" : "开始生成 →"}
          </button>
        </Tip>
      </div>
    );
  }

  if (status === "running") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-ink bg-cream px-6 py-3">
        <div className="flex min-w-0 items-center gap-2.5 text-[13px] font-bold text-soot">
          <span className="h-2 w-2 shrink-0 animate-blink rounded-full bg-klein" />
          <span className="truncate">
            专家团创作中
            {connected ? "，进展实时显示在右侧" : "（连接中断，自动重连中…）"}
          </span>
        </div>
        <Tip tip="停止本次生成，已产出的内容会保留">
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded-full border-[1.5px] border-ink bg-paper px-4 py-2 text-[13px] font-bold"
          >
            取消任务
          </button>
        </Tip>
      </div>
    );
  }

  // reviewing 是终态：稿件已交付，但部分平台含残留问题，建议人工复核/微调
  if (status === "reviewing") {
    return (
      <div className="flex items-center gap-2.5 border-t-2 border-ink bg-cream px-6 py-3 text-[13px] font-bold text-soot">
        <span className="h-2 w-2 shrink-0 rounded-full bg-amber-deep" />
        已交付（部分平台含残留问题）·
        建议复核右侧成稿，在对话里提出修改意见，专家会针对性回炉
      </div>
    );
  }

  if (status === "done") {
    return (
      <div className="flex items-center gap-2.5 border-t-2 border-ink bg-cream px-6 py-3 text-[13px] font-bold text-soot">
        <span className="h-2 w-2 shrink-0 rounded-full bg-jade" />
        已定稿 · 想微调？在对话里说一句，对应专家会针对性回炉
      </div>
    );
  }

  // failed / cancelled → 给两条出路：按原简报重新生成，或新建任务重来
  const isFailed = status === "failed";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-ink bg-cream px-6 py-3">
      <div
        className={`flex min-w-0 items-center gap-2.5 text-[13px] font-bold ${
          isFailed ? "text-poppy" : "text-stone"
        }`}
      >
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${isFailed ? "bg-poppy" : "bg-tan-dark"}`}
        />
        <span className="truncate">
          {isFailed ? `生成失败${error ? `：${error}` : ""}` : "任务已取消"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Tip tip="按原简报重新启动八阶段专家流水线">
          <button
            type="button"
            onClick={onStart}
            disabled={starting}
            className="cursor-pointer rounded-full border-[1.5px] border-ink bg-poppy px-4 py-2 text-[13px] font-bold text-paper disabled:cursor-wait disabled:opacity-60"
          >
            {starting ? "启动中…" : "↻ 重新生成"}
          </button>
        </Tip>
        <Tip tip="回到简报页，新建任务重新开稿">
          <button
            type="button"
            onClick={onNew}
            className="cursor-pointer rounded-full border-[1.5px] border-ink bg-sun px-4 py-2 text-[13px] font-bold"
          >
            ＋ 新建任务
          </button>
        </Tip>
      </div>
    </div>
  );
}

/** Cream pulse blocks while the session or a task detail is loading. */
function CenterSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4 p-7" aria-hidden>
      <div className="h-9 w-2/5 animate-pulse rounded-xl bg-cream" />
      <div className="h-24 animate-pulse rounded-2xl bg-cream" />
      <div className="h-24 w-4/5 animate-pulse rounded-2xl bg-cream" />
      <div className="mt-auto h-14 animate-pulse rounded-2xl bg-cream" />
    </div>
  );
}

/** Pulse blocks for the dark flight-deck column. */
function DeckSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <div className="h-20 animate-pulse rounded-2xl bg-cream/10" />
      <div className="h-40 animate-pulse rounded-2xl bg-cream/10" />
      <div className="h-64 animate-pulse rounded-2xl bg-cream/10" />
    </div>
  );
}
