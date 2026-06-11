"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Tip } from "@/components/shared/Tip";
import type { FileDto, TaskBrief } from "@/lib/api-types";
import { CHIP_SETS, PLATFORMS, SAMPLE_GOALS } from "@/lib/platforms";
import type { PlatformId } from "@/lib/types";

/* ===== local conversational state (UI-only, parent owns the real task) ===== */

type IntakeStep =
  | "goal"
  | "audience"
  | "platform"
  | "style"
  | "materials"
  | "ready";

const STEP_INDEX: Record<IntakeStep, number> = {
  goal: 1,
  audience: 2,
  platform: 3,
  style: 4,
  materials: 5,
  ready: 5,
};

const STEP_LABEL: Record<IntakeStep, string> = {
  goal: "目标",
  audience: "受众",
  platform: "平台",
  style: "风格",
  materials: "素材",
  ready: "完成",
};

type ChipKind = "audience" | "platforms" | "style" | "materials";

interface IntakeMessage {
  id: string;
  role: "user" | "ai";
  text: string;
  chips: ChipKind | null;
  locked: boolean;
}

const FILE_STATUS_META: Record<
  FileDto["status"],
  { label: string; cls: string }
> = {
  uploaded: { label: "已上传", cls: "bg-sand text-soot" },
  extracting: { label: "解析中…", cls: "bg-sun text-ink" },
  extracted: { label: "已解析", cls: "bg-jade text-paper" },
  failed: { label: "解析失败", cls: "bg-poppy text-paper" },
};

function FiAvatar() {
  return (
    <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[12px_12px_12px_4px] bg-poppy font-archivo text-sm text-paper">
      Fi
    </div>
  );
}

function AiBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[4px_16px_16px_16px] border-[1.5px] border-tan-light bg-cream px-[18px] py-[14px] text-[14.5px] leading-[1.8]">
      {children}
    </div>
  );
}

function FileChip({ file }: { file: FileDto }) {
  const meta = FILE_STATUS_META[file.status];
  return (
    <span
      title={
        file.status === "extracted"
          ? `已解析为素材，共 ${(file.extractedChars ?? 0).toLocaleString("zh-CN")} 字，会随简报交给专家团`
          : file.status === "failed"
            ? "解析失败 — 换个格式（如 PDF / DOCX / TXT）再试一次"
            : file.status === "extracting"
              ? "正在提取文字内容，稍等片刻…"
              : "已上传，等待解析"
      }
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border-[1.5px] border-tan-mid bg-paper px-3 py-1.5 text-[12px]"
    >
      <span className="max-w-[150px] truncate font-medium">{file.name}</span>
      <span
        className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-bold ${meta.cls}`}
      >
        {meta.label}
        {file.status === "extracted" && file.extractedChars != null && (
          <span className="font-archivo">
            {" "}
            · {file.extractedChars.toLocaleString("zh-CN")} 字
          </span>
        )}
      </span>
    </span>
  );
}

export interface BriefIntakeProps {
  onLaunch: (brief: TaskBrief) => void;
  files: FileDto[];
  onUpload: (f: File) => void;
  busy: boolean;
  defaultPlatforms?: PlatformId[];
}

/**
 * Conversational brief builder (简报 1/5 → 5/5): goal → audience → platform →
 * style → materials(+files). Pure component — the parent owns task creation;
 * we hand back a complete TaskBrief via onLaunch (派单给专家团).
 */
export function BriefIntake({
  onLaunch,
  files,
  onUpload,
  busy,
  defaultPlatforms,
}: BriefIntakeProps) {
  const [step, setStep] = useState<IntakeStep>("goal");
  const [messages, setMessages] = useState<IntakeMessage[]>([]);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState("");
  const [goal, setGoal] = useState("");
  const [audience, setAudience] = useState("");
  const [platforms, setPlatforms] = useState<PlatformId[]>([]);
  const [selected, setSelected] = useState<PlatformId[]>(
    defaultPlatforms ?? [],
  );
  const [style, setStyle] = useState("");
  const [materials, setMaterials] = useState("");
  const [notes, setNotes] = useState("");
  const [dragging, setDragging] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const idRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing, files.length]);

  const nextId = () => `bi${idRef.current++}`;

  const pushUser = useCallback((text: string) => {
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "user", text, chips: null, locked: false },
    ]);
  }, []);

  const pushAi = useCallback(
    (text: string, chips: ChipKind | null = null, ms = 750) => {
      setTyping(true);
      timersRef.current.push(
        setTimeout(() => {
          setTyping(false);
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: "ai", text, chips, locked: false },
          ]);
        }, ms),
      );
    },
    [],
  );

  const lockChips = useCallback(() => {
    setMessages((prev) =>
      prev.map((m) => (m.chips ? { ...m, locked: true } : m)),
    );
  }, []);

  /* ===== step transitions ===== */

  const answerGoal = useCallback(
    (text: string) => {
      setGoal(text);
      setStep("audience");
      pushAi(
        "收到！听起来是个不错的 campaign。第 2 步：这次内容主要想触达谁？点选下方人群，或直接输入你的描述。",
        "audience",
      );
    },
    [pushAi],
  );

  const answerAudience = useCallback(
    (text: string) => {
      setAudience(text);
      setStep("platform");
      pushAi(
        "明白。第 3 步：想发到哪些平台？可以多选——每个平台都由专属专家来写，选好后点「✓ 就这些，继续」。",
        "platforms",
      );
    },
    [pushAi],
  );

  const confirmPlatforms = useCallback(() => {
    if (step !== "platform" || selected.length === 0) return;
    const names = selected
      .map((id) => PLATFORMS.find((p) => p.id === id)?.name ?? id)
      .join("、");
    lockChips();
    pushUser(`平台：${names}`);
    setPlatforms([...selected]);
    setStep("style");
    pushAi("好选择。第 4 步：这次内容想要什么风格调性？", "style");
  }, [step, selected, lockChips, pushAi, pushUser]);

  const answerStyle = useCallback(
    (text: string) => {
      setStyle(text);
      setStep("materials");
      pushAi(
        "最后一步：手头有什么素材？点选下方选项，也可以把产品文档、卖点表直接拖进下面的上传区——我会自动解析成弹药。",
        "materials",
      );
    },
    [pushAi],
  );

  const answerMaterials = useCallback(
    (text: string) => {
      setMaterials(text);
      setStep("ready");
      pushAi(
        "简报 5/5 齐了！还可以继续补充素材文件或备注（可选）。确认无误后，点底部的「派单给专家团」，我马上召集专家开工 🚀",
      );
    },
    [pushAi],
  );

  const pickChip = useCallback(
    (kind: ChipKind, label: string) => {
      if (kind === "audience" && step === "audience") {
        lockChips();
        pushUser(label);
        answerAudience(label);
      } else if (kind === "style" && step === "style") {
        lockChips();
        pushUser(label);
        answerStyle(label);
      } else if (kind === "materials" && step === "materials") {
        lockChips();
        pushUser(label);
        answerMaterials(label);
      }
    },
    [step, lockChips, pushUser, answerAudience, answerStyle, answerMaterials],
  );

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || typing) return;
    if (step === "platform") return; // platforms are picked via chips
    setInput("");
    if (step === "goal") {
      pushUser(text);
      answerGoal(text);
    } else if (step === "audience") {
      lockChips();
      pushUser(text);
      answerAudience(text);
    } else if (step === "style") {
      lockChips();
      pushUser(text);
      answerStyle(text);
    } else if (step === "materials") {
      lockChips();
      pushUser(text);
      answerMaterials(text);
    } else {
      // ready: free-form additions become brief notes
      pushUser(text);
      setNotes((n) => (n ? `${n}\n${text}` : text));
      pushAi("收到，已记入简报备注 ✍️ 还有补充随时说。", null, 500);
    }
  }, [
    input,
    typing,
    step,
    pushUser,
    pushAi,
    lockChips,
    answerGoal,
    answerAudience,
    answerStyle,
    answerMaterials,
  ]);

  /* ===== launch ===== */

  const canLaunch = goal.trim().length > 0 && platforms.length > 0;
  const missing = [
    !goal.trim() && "创作目标",
    platforms.length === 0 && "发布平台",
  ].filter(Boolean) as string[];
  const launchTip = busy
    ? "正在派单，请稍候…"
    : canLaunch
      ? "把简报交给专家团，按平台分头创作，全程可在右侧观战"
      : `还差：${missing.join("、")} — 跟着上方对话补齐即可派单`;

  const handleLaunch = useCallback(() => {
    if (!canLaunch || busy) return;
    onLaunch({
      goal: goal.trim(),
      audience,
      platforms,
      style,
      materials,
      notes: notes.trim() || undefined,
      fileIds: files.length > 0 ? files.map((f) => f.id) : undefined,
    });
  }, [
    canLaunch,
    busy,
    onLaunch,
    goal,
    audience,
    platforms,
    style,
    materials,
    notes,
    files,
  ]);

  /* ===== upload ===== */

  const handleFiles = useCallback(
    (list: FileList | null) => {
      if (!list) return;
      Array.from(list).forEach((f) => onUpload(f));
    },
    [onUpload],
  );

  const showUpload = step === "materials" || step === "ready";

  const placeholder =
    step === "goal"
      ? "告诉灰灰你的目标，比如：下周上线冻干咖啡新品，想在小红书和抖音种草…"
      : step === "audience"
        ? "也可以直接输入受众描述，比如：二线城市新手宝妈…"
        : step === "platform"
          ? "在上方点选平台（可多选），选好后点「✓ 就这些，继续」"
          : step === "style"
            ? "也可以输入自定义风格，比如：幽默整活 · 多用网络热梗…"
            : step === "materials"
              ? "描述手头素材，或把文件拖进上方上传区…"
              : "还有补充？写在这里，会作为备注一起交给专家团…";

  const stepIdx = STEP_INDEX[step];

  return (
    <div className="flex h-full min-w-0 flex-col bg-paper">
      {/* step counter header (req 9: 用户始终知道自己在第几步) */}
      <div className="shrink-0 border-b-2 border-ink bg-cream px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="text-[15px] font-black">创作简报</span>
            <span className="ml-2 font-grotesk text-[10.5px] font-bold tracking-[2px] text-stone">
              BRIEF
            </span>
          </div>
          <span
            title="灰灰用 5 个问题补齐简报：目标 → 受众 → 平台 → 风格 → 素材"
            className="shrink-0 rounded-full border-[1.5px] border-ink bg-sun px-3 py-1 text-[11.5px] font-bold"
          >
            简报 <span className="font-archivo">{stepIdx}/5</span> ·{" "}
            {STEP_LABEL[step]}
          </span>
        </div>
        <div className="mt-2.5 flex gap-1" aria-hidden>
          {[1, 2, 3, 4, 5].map((i) => (
            <span
              key={i}
              className={`h-[5px] flex-1 rounded-full ${
                i < stepIdx
                  ? "bg-ink"
                  : i === stepIdx
                    ? step === "ready"
                      ? "bg-ink"
                      : "bg-poppy"
                    : "bg-tan"
              }`}
            />
          ))}
        </div>
      </div>

      {/* conversation */}
      <div
        ref={listRef}
        className="scrollbar-chat flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-6"
      >
        {/* welcome */}
        <div className="flex gap-3">
          <FiAvatar />
          <div className="max-w-[560px]">
            <AiBubble>
              你好，我是灰灰 👋 我会用 5 个问题帮你把创作简报补齐：目标 → 受众
              → 平台 → 风格 → 素材。简报越具体，专家团写得越准。
              <br />
              第 1 步：说说这次的创作目标吧——要推什么、想达成什么？
            </AiBubble>
          </div>
        </div>

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[480px] whitespace-pre-wrap rounded-[16px_4px_16px_16px] bg-ink px-[18px] py-[13px] text-[14.5px] leading-[1.8] text-paper">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex gap-3">
              <FiAvatar />
              <div className="flex max-w-[560px] flex-col gap-2.5">
                <AiBubble>{m.text}</AiBubble>
                {m.chips === "platforms" ? (
                  <div className="flex flex-wrap gap-2">
                    {PLATFORMS.map((p) => {
                      const on = selected.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          title={`${p.name} · ${p.job}（由 ${p.expert.name} 主笔）`}
                          onClick={
                            m.locked
                              ? undefined
                              : () =>
                                  setSelected((prev) =>
                                    prev.includes(p.id)
                                      ? prev.filter((x) => x !== p.id)
                                      : [...prev, p.id],
                                  )
                          }
                          className={`rounded-full border-[1.5px] px-[15px] py-[9px] text-[13.5px] font-medium ${
                            on
                              ? "text-white"
                              : "border-tan-mid bg-paper text-ink"
                          } ${m.locked ? "cursor-default" : "cursor-pointer"}`}
                          style={
                            on
                              ? { background: p.color, borderColor: p.color }
                              : m.locked
                                ? { opacity: 0.4 }
                                : undefined
                          }
                        >
                          {p.name}
                        </button>
                      );
                    })}
                    {!m.locked && selected.length > 0 && (
                      <button
                        type="button"
                        onClick={confirmPlatforms}
                        title={`确认 ${selected.length} 个平台，进入风格选择`}
                        className="cursor-pointer rounded-full border-[1.5px] border-ink bg-sun px-[18px] py-[9px] text-[13.5px] font-bold text-ink"
                      >
                        ✓ 就这些，继续
                      </button>
                    )}
                  </div>
                ) : m.chips ? (
                  <div className="flex flex-wrap gap-2">
                    {CHIP_SETS[m.chips].map((label) => (
                      <button
                        key={label}
                        type="button"
                        title="点击选用这个答案"
                        onClick={
                          m.locked
                            ? undefined
                            : () => pickChip(m.chips as ChipKind, label)
                        }
                        className={`rounded-full border-[1.5px] border-tan-mid bg-paper px-[15px] py-[9px] text-[13.5px] font-medium text-ink ${
                          m.locked
                            ? "cursor-default opacity-[0.45]"
                            : "cursor-pointer"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ),
        )}

        {typing && (
          <div className="flex items-center gap-3">
            <FiAvatar />
            <div className="flex gap-[5px] rounded-[4px_16px_16px_16px] border-[1.5px] border-tan-light bg-cream px-[18px] py-4">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="inline-block h-[7px] w-[7px] animate-blink rounded-full bg-stone"
                  style={{ animationDelay: `${i * 0.2}s` }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* footer: upload zone + input + launch */}
      <div className="shrink-0 border-t-2 border-ink bg-paper px-5 py-4">
        {step === "goal" && (
          <div className="mb-3 flex flex-wrap gap-2">
            <span className="self-center text-[12.5px] text-stone">试试：</span>
            {SAMPLE_GOALS.map((g) => (
              <button
                key={g}
                type="button"
                title="点击直接用这个目标开始"
                onClick={() => {
                  if (typing) return;
                  pushUser(g);
                  answerGoal(g);
                }}
                className="cursor-pointer rounded-full border-[1.5px] border-dashed border-tan-dark bg-cream px-[14px] py-2 text-[13px] text-soot"
              >
                {g}
              </button>
            ))}
          </div>
        )}

        {showUpload && (
          <div className="mb-3">
            <div
              role="button"
              tabIndex={0}
              title="点击或拖拽文件到这里上传素材（产品文档、卖点表、图片等），解析后随简报交给专家团"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                handleFiles(e.dataTransfer.files);
              }}
              className={`cursor-pointer rounded-[14px] border-2 border-dashed px-4 py-3 text-center text-[12.5px] transition-colors ${
                dragging
                  ? "border-klein bg-mist/40 text-klein"
                  : "border-tan-dark bg-cream text-soot"
              }`}
            >
              📎 拖拽文件到这里，或点击选择 — 文档会自动解析成创作素材
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              aria-label="上传素材文件"
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
            {files.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {files.map((f) => (
                  <FileChip key={f.id} file={f} />
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                handleSend();
              }
            }}
            disabled={step === "platform"}
            placeholder={placeholder}
            title={
              step === "platform"
                ? "这一步请在上方点选平台标签"
                : "输入后回车发送"
            }
            className="min-w-0 flex-1 rounded-[14px] border-2 border-ink bg-paper px-[18px] py-[13px] text-[14.5px] outline-none disabled:border-tan-mid disabled:bg-cream disabled:text-stone"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={step === "platform" || !input.trim()}
            title={
              step === "platform"
                ? "这一步请在上方点选平台标签"
                : "发送给灰灰（回车也可以）"
            }
            className={`rounded-[14px] border-2 px-[22px] text-[14.5px] font-bold ${
              step === "platform" || !input.trim()
                ? "cursor-not-allowed border-tan-mid bg-cream text-stone"
                : "cursor-pointer border-ink bg-ink text-paper"
            }`}
          >
            发送 →
          </button>
        </div>

        <div className="mt-3">
          <Tip tip={launchTip}>
            <button
              type="button"
              onClick={handleLaunch}
              disabled={!canLaunch || busy}
              className={`w-full rounded-[14px] border-2 border-ink px-5 py-3 text-[15px] font-bold ${
                canLaunch && !busy
                  ? "cursor-pointer bg-poppy text-paper shadow-[4px_4px_0_#17130C] transition-transform hover:-translate-y-0.5"
                  : "cursor-not-allowed bg-sand text-stone shadow-none"
              }`}
            >
              {busy ? "派单中…" : "🚀 派单给专家团"}
            </button>
          </Tip>
        </div>
      </div>
    </div>
  );
}
