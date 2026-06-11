"use client";

import { useEffect, useRef, useState } from "react";
import { BurstStar } from "@/components/shared/BurstStar";
import { PIPELINE_STAGES, type TaskEventDto } from "@/lib/api-types";
import { PLATFORMS } from "@/lib/platforms";

/** Stable avatar palette — agents keep the same color across renders. */
const AVATAR_COLORS: { bg: string; fg: string }[] = [
  { bg: "#FF4B2E", fg: "#FFFDF7" },
  { bg: "#2849F4", fg: "#FFFDF7" },
  { bg: "#FFC53D", fg: "#17130C" },
  { bg: "#0FA36B", fg: "#FFFDF7" },
  { bg: "#FF7AB6", fg: "#17130C" },
  { bg: "#25F4EE", fg: "#17130C" },
  { bg: "#D99A00", fg: "#17130C" },
];

function avatarColor(agentId: string) {
  let h = 0;
  for (let i = 0; i < agentId.length; i++)
    h = (h * 31 + agentId.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

const TOOL_LABELS: Record<string, string> = {
  web_search: "TAVILY 搜索",
  scrape: "FIRECRAWL 抓取",
  image_generate: "图像生成",
};

function clock(ts: string) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : d.toTimeString().slice(0, 8);
}

/**
 * 思考过程 stream — the live timeline of pipeline events (req 4: thinking on
 * screen). Auto-scrolls to the newest row while live; pauses when the user
 * scrolls up and offers a 回到最新 pill. Pure presentational.
 */
export function ThinkingTimeline({
  events,
  live,
}: {
  events: TaskEventDto[];
  live: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  // `seq@ts` → user override of the default open/closed state. The key is
  // unique across tasks, so switching tasks never needs a state reset.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const rowKey = (ev: TaskEventDto) => `${ev.seq}@${ev.ts}`;
  const defaultOpen = (t: TaskEventDto["type"]) =>
    t === "thinking" || t === "review";
  const isOpen = (ev: TaskEventDto) => {
    const c = collapsed[rowKey(ev)];
    return c === undefined ? defaultOpen(ev.type) : !c;
  };
  const toggle = (ev: TaskEventDto) =>
    setCollapsed((m) => ({ ...m, [rowKey(ev)]: isOpen(ev) }));

  // Follow the newest row while live, unless the user scrolled away.
  useEffect(() => {
    const el = listRef.current;
    if (el && live && pinned) el.scrollTop = el.scrollHeight;
  }, [events.length, live, pinned]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  };

  const backToLatest = () => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setPinned(true);
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 pb-2.5">
        <span className="text-[15px] font-black text-paper">思考过程</span>
        <span className="font-grotesk text-[10px] font-bold tracking-[2px] text-stone">
          THINKING STREAM
        </span>
        {live && (
          <span
            className="ml-auto flex items-center gap-1.5 rounded-full border border-sun px-2 py-0.5"
            title="流水线运行中，思考实时直播"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sun" />
            <span className="font-grotesk text-[9px] font-bold tracking-[1.5px] text-sun">
              LIVE
            </span>
          </span>
        )}
      </div>

      {events.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
          <BurstStar size={56} fill="rgba(255,197,61,.3)" />
          <div className="text-[13.5px] font-bold text-paper">
            还没有思考记录
          </div>
          <div className="text-[12.5px] leading-[1.9] text-stone">
            点击「开始生成」启动流水线
            <br />
            专家团的实时思考会逐条出现在这里
          </div>
        </div>
      ) : (
        <div
          ref={listRef}
          onScroll={onScroll}
          className="scrollbar-studio min-h-0 flex-1 overflow-y-auto pr-1"
        >
          <ol className="flex flex-col">
            {events.map((ev, i) => (
              <EventRow
                key={ev.seq}
                ev={ev}
                isLast={i === events.length - 1}
                live={live}
                open={isOpen(ev)}
                onToggle={() => toggle(ev)}
              />
            ))}
          </ol>
        </div>
      )}

      {live && !pinned && (
        <button
          type="button"
          onClick={backToLatest}
          title="跳回时间线最新一条"
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 cursor-pointer items-center gap-1 rounded-full border-[1.5px] border-ink bg-sun px-3.5 py-1.5 text-[12px] font-bold text-ink shadow-[3px_3px_0_rgba(0,0,0,.4)]"
        >
          ↓ 回到最新
        </button>
      )}
    </div>
  );
}

function EventRow({
  ev,
  isLast,
  live,
  open,
  onToggle,
}: {
  ev: TaskEventDto;
  isLast: boolean;
  live: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const text = ev.detail?.text;
  const platformId = ev.detail?.platform;
  const platform = platformId
    ? PLATFORMS.find((p) => p.id === platformId)
    : undefined;
  const stageId = ev.detail?.stage;
  const stageMeta =
    typeof stageId === "string"
      ? PIPELINE_STAGES.find((s) => s.id === stageId)
      : undefined;
  const score = ev.detail?.score;
  const verdict = ev.detail?.verdict;
  const toolName = ev.detail?.toolName;
  const expandable = Boolean(text) && ev.type !== "error";

  const cursor =
    isLast && live ? (
      <span className="ml-0.5 animate-blink font-bold text-sun">▌</span>
    ) : null;

  const platformChip = platform ? (
    <span
      className="rounded-full px-1.5 py-[2px] text-[9.5px] font-bold leading-none text-white"
      style={{ background: platform.uiColor }}
    >
      {platform.name}
    </span>
  ) : null;

  const avatar = ev.agentId ? (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] text-[12.5px] font-bold"
      style={{
        background: avatarColor(ev.agentId).bg,
        color: avatarColor(ev.agentId).fg,
      }}
      title={`${ev.agentName ?? ev.agentId}（${ev.agentId}）`}
    >
      {(ev.agentName ?? ev.agentId).slice(0, 1)}
    </span>
  ) : (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] border border-[rgba(255,253,247,.22)] bg-[rgba(255,253,247,.08)] text-[12px] text-tan-dark"
      title="流水线调度"
    >
      ✦
    </span>
  );

  let head: React.ReactNode;
  if (ev.type === "stage_start") {
    head = (
      <>
        {stageMeta && (
          <span className="rounded-full bg-paper px-2 py-[2px] text-[10px] font-bold leading-none text-ink">
            {stageMeta.label}
          </span>
        )}
        <span className="text-[13.5px] font-black text-paper">{ev.title}</span>
        {stageMeta && (
          <span className="font-grotesk text-[9px] font-bold tracking-[1.5px] text-sun">
            {stageMeta.en}
          </span>
        )}
        {cursor}
      </>
    );
  } else if (ev.type === "stage_done") {
    head = (
      <span className="text-[12.5px] text-stone">
        ✓ {ev.title}
        {cursor}
      </span>
    );
  } else if (ev.type === "thinking") {
    head = (
      <>
        <BurstStar size={11} fill="#FFC53D" className="shrink-0" />
        <span className="text-[13px] font-bold text-paper">{ev.title}</span>
        {platformChip}
        {cursor}
      </>
    );
  } else if (ev.type === "tool_call") {
    head = (
      <>
        <span className="rounded-md bg-klein px-1.5 py-[3px] font-grotesk text-[9px] font-bold leading-none tracking-[1px] text-paper">
          {toolName ? (TOOL_LABELS[toolName] ?? toolName.toUpperCase()) : "TOOL"}
        </span>
        <span className="font-mono text-[12px] text-tan-light">{ev.title}</span>
        {cursor}
      </>
    );
  } else if (ev.type === "review") {
    head = (
      <>
        <span className="text-[13px] font-bold text-paper">{ev.title}</span>
        {typeof score === "number" && (
          <span
            className="rounded-full px-2 py-[3px] font-archivo text-[10px] leading-none text-white"
            style={{ background: score >= 75 ? "#0FA36B" : "#FF4B2E" }}
            title={`评审得分 ${score} / 100（及格线 75）`}
          >
            {score} 分
          </span>
        )}
        {verdict === "pass" ? (
          <span className="rounded-full border border-jade px-2 py-[2px] text-[10px] font-bold leading-none text-jade">
            通过
          </span>
        ) : verdict === "revise" ? (
          <span className="rounded-full border border-poppy px-2 py-[2px] text-[10px] font-bold leading-none text-poppy">
            需修改
          </span>
        ) : null}
        {platformChip}
        {cursor}
      </>
    );
  } else if (ev.type === "artifact") {
    head = (
      <>
        <span className="text-[12.5px] text-tan-light">{ev.title}</span>
        <span
          className="rounded-full border border-dashed border-tan-dark px-2 py-[2px] text-[10px] leading-none text-tan-light underline decoration-dotted underline-offset-2"
          title={
            ev.detail?.artifactId
              ? `产物 ID：${ev.detail.artifactId}`
              : undefined
          }
        >
          {platform ? platform.name : "产物"}
          {ev.detail?.artifactId ? ` · #${ev.detail.artifactId.slice(0, 6)}` : ""}
        </span>
        {cursor}
      </>
    );
  } else if (ev.type === "pipeline_done") {
    head = (
      <>
        <BurstStar size={12} fill="#0FA36B" className="shrink-0" />
        <span className="text-[13.5px] font-black text-jade">{ev.title}</span>
        {cursor}
      </>
    );
  } else {
    head = (
      <span className="text-[13px] text-paper">
        {ev.title}
        {cursor}
      </span>
    );
  }

  const time = (
    <span
      className="ml-auto shrink-0 font-grotesk text-[9.5px] tracking-[1px] text-[rgba(255,253,247,.4)]"
      suppressHydrationWarning
    >
      {clock(ev.ts)}
    </span>
  );

  return (
    <li className="relative flex gap-3 pb-4 last:pb-1">
      {!isLast && (
        <span
          aria-hidden
          className="absolute bottom-0 left-[13px] top-8 w-px bg-[rgba(255,253,247,.13)]"
        />
      )}
      {avatar}
      <div className="min-w-0 flex-1 pt-[3px]">
        {ev.type === "error" ? (
          <div className="rounded-[10px] border-[1.5px] border-poppy bg-[rgba(255,75,46,.16)] px-3 py-2">
            <div className="flex items-baseline gap-2">
              <span className="text-[13px] font-bold text-paper">
                ⚠ {ev.title}
                {cursor}
              </span>
              {time}
            </div>
            {text && (
              <div className="mt-1 text-[12px] leading-[1.75] text-[#FFD9CF]">
                {text}
              </div>
            )}
          </div>
        ) : (
          <>
            {expandable ? (
              <button
                type="button"
                onClick={onToggle}
                title={open ? "收起详情" : "展开详情"}
                className="flex w-full cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 text-left"
              >
                {head}
                <span className="text-[10px] text-stone">
                  {open ? "▾" : "▸"}
                </span>
                {time}
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {head}
                {time}
              </div>
            )}
            {expandable &&
              open &&
              (ev.type === "thinking" ? (
                <blockquote className="mt-1.5 border-l-[3px] border-sun pl-3 text-[12.5px] italic leading-[1.85] text-tan-light">
                  {text}
                </blockquote>
              ) : ev.type === "tool_call" ? (
                <div className="mt-1.5 break-all rounded-[8px] bg-[rgba(255,253,247,.07)] px-2.5 py-1.5 font-mono text-[11.5px] leading-[1.7] text-tan-light">
                  {text}
                </div>
              ) : (
                <div className="mt-1.5 text-[12.5px] leading-[1.8] text-tan-light">
                  {text}
                </div>
              ))}
          </>
        )}
      </div>
    </li>
  );
}
