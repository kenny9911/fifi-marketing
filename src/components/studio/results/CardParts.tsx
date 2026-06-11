import { useEffect, useRef, useState } from "react";

/** Dashed-divider block listing the expert's per-platform tuning notes. */
export function TuningNotes({
  name,
  notes,
  className,
}: {
  /** expert persona name, e.g. 桃桃 */
  name: string;
  notes: string[];
  className?: string;
}) {
  return (
    <div
      className={
        "border-t-[1.5px] border-dashed border-tan pt-3.5" +
        (className ? ` ${className}` : "")
      }
    >
      <div className="mb-2 text-xs font-bold text-stone">
        {name}的调优说明
      </div>
      <div className="flex flex-wrap gap-1.5">
        {notes.map((note) => (
          <span
            key={note}
            className="rounded-full border border-tan-light bg-cream px-2.5 py-1 text-xs"
          >
            {note}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Action row under a result card: one filled primary button plus two
 * outlined ones. When `copyText` is set, the primary button writes it to the
 * clipboard and flashes 已复制 ✓ for ~1.6s; otherwise it stays visual-only,
 * like the secondary buttons (real refinement actions arrive with the agent
 * backend).
 */
export function ResultActions({
  primary,
  copyText,
  secondary,
  className,
}: {
  primary: string;
  copyText?: string;
  secondary: [string, string];
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const handlePrimary = async () => {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
    } catch {
      return;
    }
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className={"flex gap-2.5" + (className ? ` ${className}` : "")}>
      <button
        type="button"
        onClick={handlePrimary}
        className="flex-1 cursor-pointer rounded-[10px] bg-ink p-[11px] text-[13.5px] font-bold text-paper transition-opacity hover:opacity-90"
      >
        {copied ? "已复制 ✓" : primary}
      </button>
      {secondary.map((label) => (
        <button
          key={label}
          type="button"
          className="cursor-pointer rounded-[10px] border-[1.5px] border-ink bg-paper px-4 py-[11px] text-[13.5px] font-bold transition-colors hover:bg-cream"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
