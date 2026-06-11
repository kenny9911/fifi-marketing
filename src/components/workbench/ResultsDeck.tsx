"use client";

import { useEffect, useRef, useState } from "react";
import { Tip } from "@/components/shared/Tip";
import { DyCard } from "@/components/studio/results/DyCard";
import { GenericCard } from "@/components/studio/results/GenericCard";
import { MpCard } from "@/components/studio/results/MpCard";
import { XhsCard } from "@/components/studio/results/XhsCard";
import type {
  ImageArtifactDto,
  PromptPackDto,
  TaskDetail,
  TaskStatus,
} from "@/lib/api-types";
import { getPlatform } from "@/lib/platforms";
import type { PlatformId } from "@/lib/types";

/** Next-step hint shown in place of a missing final, keyed by task status. */
const FINAL_HINTS: Record<TaskStatus, string> = {
  briefing: "完成简报并点击「开始生成」后，本平台的成稿会出现在这里",
  running: "专家团正在创作中 — 「定稿交付」完成后第一时间展示成稿",
  reviewing: "本平台暂无成稿 — 在对话里输入修改意见，让专家重写一版",
  done: "本平台暂无成稿 — 在对话里输入修改意见，让专家重写一版",
  failed: "任务执行失败 — 点对话下方的「重新生成」重试，或新建任务调整简报",
  cancelled: "任务已取消 — 点对话下方的「重新生成」即可继续",
};

const KIND_META: Record<PromptPackDto["kind"], { label: string; bg: string }> =
  {
    text: { label: "文案", bg: "#2849F4" },
    image: { label: "配图", bg: "#0FA36B" },
    video: { label: "视频", bg: "#FF4B2E" },
  };

/**
 * Per-platform deliverables: result tabs (final card + prompt packs +
 * generated images + 生成配图). Finals are always the latest version; a
 * 已回炉重写 badge marks revised runs. Result-card refine buttons (换个角度
 * etc.) send a platform-scoped revision directive through `onRefine` — the
 * same flow as typing a修改意见 in the chat.
 */
export function ResultsDeck({
  detail,
  onGenerateImage,
  imageBusy,
  hasRevision,
  onRefine,
  refineBusy,
}: {
  detail: TaskDetail;
  onGenerateImage: (platform: PlatformId) => void;
  imageBusy: boolean;
  /** falls back to scanning detail.events for a reedit stage_start */
  hasRevision?: boolean;
  /** sends a revision directive (task message → targeted reedit) */
  onRefine?: (directive: string) => void;
  refineBusy?: boolean;
}) {
  const platforms = detail.brief.platforms;
  const [picked, setPicked] = useState<PlatformId | null>(null);
  // Derived active tab: survives task switches without an effect.
  const tab = picked && platforms.includes(picked) ? picked : (platforms[0] ?? null);

  const revised =
    hasRevision ??
    detail.events.some(
      (e) => e.type === "stage_start" && e.detail?.stage === "reedit",
    );

  if (!tab) {
    return (
      <div className="flex flex-col">
        <DeckHeader revised={revised} />
        <EmptyHint text="简报里还没有选择投放平台 — 回到对话选好平台后，成果会按平台分栏展示" />
      </div>
    );
  }

  const platform = getPlatform(tab);
  const final = detail.finals[tab];
  const packs = detail.promptPacks.filter(
    (p) => p.platform === tab || p.platform === null,
  );
  const images = detail.images.filter(
    (i) => i.platform === tab || i.platform === null,
  );

  // 回炉微调只在交付后可用（与 /api/tasks/:id/message 的修订触发条件一致）
  const revisable = detail.status === "done" || detail.status === "reviewing";
  const refine =
    onRefine && revisable && !refineBusy
      ? (label: string) => onRefine(`「${platform.name}」平台的稿件：${label}`)
      : undefined;
  const refineDisabledReason = refineBusy
    ? "修改意见发送中…"
    : revisable
      ? undefined
      : "交付完成后才能回炉微调 — 专家团创作中请稍候";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DeckHeader revised={revised} />

      {/* platform tabs */}
      <div className="flex flex-wrap gap-2 pb-3">
        {platforms.map((id) => {
          const p = getPlatform(id);
          const active = id === tab;
          const f = detail.finals[id];
          const errored = f?.kind === "generic" && f.error;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setPicked(id)}
              title={`${p.expert.name} · ${p.job}${f ? (errored ? " · 生成失败" : " · 已定稿") : ""}`}
              className={`cursor-pointer rounded-full border-[1.5px] px-3.5 py-1.5 text-[13px] font-bold ${
                active
                  ? "text-white"
                  : "border-[rgba(255,253,247,.3)] bg-transparent text-tan-dark"
              }`}
              style={
                active
                  ? { background: p.uiColor, borderColor: p.uiColor }
                  : undefined
              }
            >
              {p.name}
              {f ? (errored ? " !" : " ✓") : ""}
            </button>
          );
        })}
      </div>

      <div className="scrollbar-studio flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pb-4 pr-1">
        {/* final result card */}
        {final ? (
          final.kind === "xhs" ? (
            <XhsCard
              result={final}
              onRefine={refine}
              refineDisabledReason={refineDisabledReason}
            />
          ) : final.kind === "dy" ? (
            <DyCard
              result={final}
              onRefine={refine}
              refineDisabledReason={refineDisabledReason}
            />
          ) : final.kind === "mp" ? (
            <MpCard
              result={final}
              onRefine={refine}
              refineDisabledReason={refineDisabledReason}
            />
          ) : (
            <GenericCard
              result={final}
              platform={platform}
              onRefine={refine}
              refineDisabledReason={refineDisabledReason}
            />
          )
        ) : (
          <EmptyHint text={FINAL_HINTS[detail.status]} />
        )}

        {/* prompt packs */}
        <section className="flex flex-col gap-2.5">
          <SectionLabel
            zh="提示词包"
            en="PROMPT PACKS"
            right={
              packs.length > 0 ? (
                <span className="font-archivo text-[11px] text-stone">
                  {packs.length}
                </span>
              ) : null
            }
          />
          {packs.length > 0 ? (
            packs.map((p) => <PromptPackCard key={p.id} pack={p} />)
          ) : (
            <EmptyHint text="提示词包会在「提示词工程」阶段产出 — 开始生成后，这里会给出可直接粘贴使用的文案 / 配图 / 视频提示词" />
          )}
        </section>

        {/* generated images */}
        <section className="flex flex-col gap-2.5">
          <SectionLabel
            zh="平台配图"
            en="IMAGES"
            right={
              <Tip tip="由「选模」Agent 挑选最合适的图像模型并生成本平台配图">
                <button
                  type="button"
                  disabled={imageBusy}
                  onClick={() => onGenerateImage(tab)}
                  className="flex cursor-pointer items-center gap-1.5 rounded-full border-[1.5px] border-ink bg-sun px-3.5 py-1.5 text-[12px] font-bold text-ink disabled:cursor-default disabled:opacity-60"
                >
                  {imageBusy ? (
                    <>
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-ink border-t-transparent" />
                      生成中…
                    </>
                  ) : (
                    "✦ 生成配图"
                  )}
                </button>
              </Tip>
            }
          />
          {images.length > 0 ? (
            <ImagesGrid images={images} />
          ) : (
            <EmptyHint text="还没有配图 — 点右上「生成配图」，由选模 Agent 挑选模型出图" />
          )}
        </section>
      </div>
    </div>
  );
}

function DeckHeader({ revised }: { revised: boolean }) {
  return (
    <div className="flex items-center gap-2.5 pb-3">
      <span className="text-[15px] font-black text-paper">成果交付</span>
      <span className="font-grotesk text-[10px] font-bold tracking-[2px] text-stone">
        DELIVERABLES
      </span>
      {revised && (
        <div className="ml-auto">
          <Tip tip="总编复核未通过的稿件已回炉重写，当前展示的是最新一版">
            <span className="flex items-center gap-1 rounded-full border-[1.5px] border-ink bg-sun px-2.5 py-1 text-[10.5px] font-bold text-ink">
              ↺ 已回炉重写
            </span>
          </Tip>
        </div>
      )}
    </div>
  );
}

function SectionLabel({
  zh,
  en,
  right,
}: {
  zh: string;
  en: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 pt-1">
      <div className="flex items-baseline gap-2">
        <span className="text-[14px] font-bold text-paper">{zh}</span>
        <span className="font-grotesk text-[10px] font-bold tracking-[2px] text-stone">
          {en}
        </span>
      </div>
      {right}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-[14px] border-[1.5px] border-dashed border-[rgba(255,253,247,.25)] px-4 py-5 text-center text-[12.5px] leading-[1.9] text-stone">
      {text}
    </div>
  );
}

function PromptPackCard({ pack }: { pack: PromptPackDto }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pack.prompt);
    } catch {
      return;
    }
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1600);
  };

  const kind = KIND_META[pack.kind];

  return (
    <div className="rounded-[14px] bg-paper p-3.5">
      <div className="flex items-center gap-2">
        <span
          className="rounded-full px-2.5 py-[3px] text-[11px] font-bold leading-none text-white"
          style={{ background: kind.bg }}
        >
          {kind.label}
        </span>
        {pack.platform === null && (
          <span
            className="rounded-full border border-tan-mid px-2 py-[2px] text-[10px] font-bold leading-none text-stone"
            title="不限平台的通用提示词"
          >
            通用
          </span>
        )}
        {pack.targetModel && (
          <span
            className="rounded-md bg-cream px-1.5 py-[3px] font-grotesk text-[9.5px] font-bold leading-none tracking-[1px] text-soot"
            title={`为 ${pack.targetModel} 调优`}
          >
            {pack.targetModel}
          </span>
        )}
        <div className="ml-auto">
          <Tip tip="复制提示词，可直接粘贴到对应生成器使用">
            <button
              type="button"
              onClick={copy}
              className={`cursor-pointer rounded-full border-[1.5px] border-ink px-3 py-1 text-[11.5px] font-bold ${
                copied ? "bg-jade text-white" : "bg-ink text-paper"
              }`}
            >
              {copied ? "已复制 ✓" : "复制"}
            </button>
          </Tip>
        </div>
      </div>
      <div className="scrollbar-chat mt-2.5 max-h-44 overflow-y-auto whitespace-pre-wrap break-words rounded-[10px] border-[1.5px] border-tan-light bg-cream px-3 py-2.5 font-mono text-[12px] leading-[1.7] text-soot">
        {pack.prompt}
      </div>
      {pack.rationale && (
        <details className="mt-2">
          <summary
            className="cursor-pointer select-none text-[12px] font-bold text-stone"
            title="查看这条提示词的设计思路"
          >
            为什么这样写
          </summary>
          <div className="mt-1.5 border-l-[3px] border-sun pl-2.5 text-[12.5px] leading-[1.8] text-soot">
            {pack.rationale}
          </div>
        </details>
      )}
    </div>
  );
}

function ImagesGrid({ images }: { images: ImageArtifactDto[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {images.map((img) => (
        <figure key={img.id} className="overflow-hidden rounded-[12px] bg-paper">
          {/* presigned MinIO URL — skip next/image optimization */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={img.url}
            alt={img.prompt}
            className="aspect-square w-full object-cover"
          />
          <figcaption className="px-2.5 pb-2.5 pt-2">
            <div
              className="line-clamp-2 text-[11px] leading-[1.6] text-soot"
              title={img.prompt}
            >
              {img.prompt}
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="truncate font-grotesk text-[9px] font-bold uppercase tracking-[1px] text-stone">
                {img.model}
              </span>
              <a
                href={img.url}
                download
                target="_blank"
                rel="noreferrer"
                title="下载原图"
                className="shrink-0 rounded-full border-[1.5px] border-ink bg-cream px-2 py-[2px] text-[10.5px] font-bold text-ink"
              >
                下载 ↓
              </a>
            </div>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
