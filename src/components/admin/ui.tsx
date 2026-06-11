"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

/* ===== Toasts ============================================================ */

export type ToastTone = "ok" | "err";

interface ToastItem {
  id: number;
  text: string;
  tone: ToastTone;
}

type PushToast = (text: string, tone?: ToastTone) => void;

const ToastContext = createContext<PushToast>(() => {});

/** `const toast = useToast(); toast("已保存"); toast("失败", "err");` */
export function useToast(): PushToast {
  return useContext(ToastContext);
}

/** Wraps the console; renders the bottom-right toast shelf. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const push = useCallback<PushToast>((text, tone = "ok") => {
    const id = ++seq.current;
    setItems((prev) => [...prev.slice(-3), { id, text, tone }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-5 bottom-5 z-[90] flex w-[min(340px,calc(100vw-40px))] flex-col gap-2"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={`rounded-xl border-2 border-ink px-4 py-2.5 text-[13px] font-bold shadow-[4px_4px_0_#17130C] ${
              t.tone === "ok" ? "bg-jade text-paper" : "bg-poppy text-paper"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ===== Small pop-collage atoms ========================================== */

/** Section heading: black Chinese title + tracked grotesk EN accent. */
export function SectionHead({
  title,
  en,
  desc,
  children,
}: {
  title: string;
  en: string;
  desc?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="text-[18px] font-black">{title}</div>
        <div className="font-grotesk text-[11px] font-bold tracking-[2px] text-stone">
          {en}
        </div>
        {desc ? (
          <p className="mt-1.5 max-w-[640px] text-[13px] leading-[1.8] text-soot">
            {desc}
          </p>
        ) : null}
      </div>
      {children ? <div className="flex items-center gap-2.5">{children}</div> : null}
    </div>
  );
}

/** Ink-bordered on/off switch (jade when on). */
export function InkToggle({
  on,
  label,
  busy,
  onChange,
}: {
  on: boolean;
  /** accessible name + hover hint */
  label: string;
  busy?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={() => onChange(!on)}
      className={`relative h-[22px] w-[42px] shrink-0 cursor-pointer rounded-full border-2 border-ink transition-colors disabled:cursor-wait disabled:opacity-50 ${
        on ? "bg-jade" : "bg-sand"
      }`}
    >
      <span
        className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-ink transition-all ${
          on ? "left-[22px]" : "left-[2px]"
        }`}
      />
    </button>
  );
}

/** Centered hint for empty/loading lists — always tells the next step. */
export function EmptyHint({
  icon = "◌",
  title,
  next,
}: {
  icon?: string;
  title: string;
  /** what the user should do next */
  next: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[18px] border-2 border-dashed border-tan-mid bg-paper px-8 py-12 text-center">
      <span className="font-archivo text-[28px] text-tan-dark" aria-hidden>
        {icon}
      </span>
      <div className="text-[15px] font-bold">{title}</div>
      <div className="text-[13px] leading-[1.8] text-soot">{next}</div>
    </div>
  );
}

/** Pulsing three-dot loading row. */
export function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-3 rounded-[18px] border-2 border-tan bg-paper px-8 py-10 text-[13.5px] font-bold text-soot">
      <span className="animate-blink h-2 w-2 rounded-full bg-poppy" />
      <span className="animate-blink h-2 w-2 rounded-full bg-sun [animation-delay:.2s]" />
      <span className="animate-blink h-2 w-2 rounded-full bg-klein [animation-delay:.4s]" />
      {label}
    </div>
  );
}

/** Prompt-version lifecycle pill. */
export function StatusPill({ status }: { status: "active" | "proposed" | "retired" }) {
  const map = {
    active: { label: "启用中", cls: "bg-jade text-paper" },
    proposed: { label: "待启用", cls: "bg-sun text-ink" },
    retired: { label: "已退役", cls: "bg-sand text-soot" },
  } as const;
  const m = map[status];
  return (
    <span
      className={`inline-flex items-center rounded-full border-[1.5px] border-ink px-2.5 py-[2px] text-[11px] font-bold ${m.cls}`}
    >
      {m.label}
    </span>
  );
}

/** Shared select styling (model pickers, window pickers …). */
export const selectCls =
  "cursor-pointer rounded-lg border-[1.5px] border-ink bg-paper px-2 py-1.5 font-grotesk text-[12px] font-bold text-ink outline-none focus:bg-cream disabled:cursor-wait disabled:opacity-50";

/** Primary pill button (ink). */
export const inkBtnCls =
  "cursor-pointer rounded-full border-2 border-ink bg-ink px-4 py-1.5 text-[12.5px] font-bold text-paper shadow-[3px_3px_0_#FFC53D] transition-transform hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:translate-y-0";

/** Secondary pill button (paper). */
export const paperBtnCls =
  "cursor-pointer rounded-full border-2 border-ink bg-paper px-4 py-1.5 text-[12.5px] font-bold text-ink transition-colors hover:bg-cream disabled:cursor-not-allowed disabled:opacity-40";
