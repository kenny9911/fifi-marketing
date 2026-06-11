import type { ReactNode } from "react";

/**
 * Dependency-free renderer for the evolution report's markdown subset:
 * #/##/### headings, -/* bullets, 1. ordered lists, ``` fences, | table rows
 * (rendered as mono lines), **bold** and `code` inline. Anything fancier
 * falls back to a plain paragraph.
 */

type Block =
  | { kind: "h1" | "h2" | "h3"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "pre"; text: string }
  | { kind: "p"; text: string };

function parseBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // fenced code → verbatim block
    if (trimmed.startsWith("```")) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1; // skip closing fence
      blocks.push({ kind: "pre", text: buf.join("\n") });
      continue;
    }

    // pipe-table rows → grouped mono block (good enough for stat tables)
    if (trimmed.startsWith("|")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        buf.push(lines[i].trim());
        i += 1;
      }
      blocks.push({ kind: "pre", text: buf.join("\n") });
      continue;
    }

    const h = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (h) {
      const kind = (["h1", "h2", "h3"] as const)[h[1].length - 1];
      blocks.push({ kind, text: h[2] });
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i += 1;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, ""));
        i += 1;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }

    // plain paragraph — merge consecutive non-special lines
    const buf: string[] = [];
    while (i < lines.length) {
      const t = lines[i].trim();
      if (
        !t ||
        t.startsWith("#") ||
        t.startsWith("```") ||
        t.startsWith("|") ||
        /^[-*]\s+/.test(t) ||
        /^\d+[.)]\s+/.test(t)
      ) {
        break;
      }
      buf.push(t);
      i += 1;
    }
    blocks.push({ kind: "p", text: buf.join(" ") });
  }

  return blocks;
}

/** `**bold**` and `` `code` `` inside a line. */
function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={idx} className="font-bold text-ink">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={idx}
          className="rounded bg-sand px-1 py-px font-mono text-[12px] text-ink"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

export function MarkdownLite({ md }: { md: string }) {
  const blocks = parseBlocks(md);

  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, idx) => {
        switch (block.kind) {
          case "h1":
            return (
              <div key={idx} className="mt-1 font-display text-[24px] font-normal leading-[1.4]">
                {renderInline(block.text)}
              </div>
            );
          case "h2":
            return (
              <div key={idx} className="mt-3 flex items-center gap-2">
                <span className="h-[14px] w-[5px] shrink-0 rounded-full bg-poppy" aria-hidden />
                <span className="text-[16px] font-black">{renderInline(block.text)}</span>
              </div>
            );
          case "h3":
            return (
              <div key={idx} className="mt-1 text-[14px] font-bold">
                {renderInline(block.text)}
              </div>
            );
          case "ul":
            return (
              <ul key={idx} className="flex flex-col gap-1.5">
                {block.items.map((item, j) => (
                  <li key={j} className="flex gap-2 text-[13.5px] leading-[1.8] text-soot">
                    <span className="mt-[9px] h-[6px] w-[6px] shrink-0 rounded-[2px] bg-klein" aria-hidden />
                    <span className="min-w-0 break-words">{renderInline(item)}</span>
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={idx} className="flex flex-col gap-1.5">
                {block.items.map((item, j) => (
                  <li key={j} className="flex gap-2 text-[13.5px] leading-[1.8] text-soot">
                    <span className="shrink-0 font-archivo text-[12px] text-poppy">
                      {j + 1}.
                    </span>
                    <span className="min-w-0 break-words">{renderInline(item)}</span>
                  </li>
                ))}
              </ol>
            );
          case "pre":
            return (
              <pre
                key={idx}
                className="overflow-x-auto rounded-xl border-[1.5px] border-tan bg-cream p-3 font-mono text-[11.5px] leading-[1.7] whitespace-pre-wrap text-ink"
              >
                {block.text}
              </pre>
            );
          case "p":
            return (
              <p key={idx} className="text-[13.5px] leading-[1.9] break-words text-soot">
                {renderInline(block.text)}
              </p>
            );
        }
      })}
    </div>
  );
}
