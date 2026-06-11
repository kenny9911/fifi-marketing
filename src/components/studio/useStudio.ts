"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CHIP_SETS, PLATFORMS, getPlatform } from "@/lib/platforms";
import type {
  Brief,
  ChatMessage,
  ChipSetId,
  ExpertProgress,
  PlatformId,
  StudioPhase,
} from "@/lib/types";

const EMPTY_BRIEF: Brief = {
  goal: "",
  audience: "",
  platforms: [],
  style: "",
  materials: "",
};

export interface StudioState {
  phase: StudioPhase;
  messages: ChatMessage[];
  typing: boolean;
  input: string;
  brief: Brief;
  selectedPlatforms: PlatformId[];
  experts: ExpertProgress[];
  activeResult: PlatformId;
}

export interface StudioActions {
  setInput: (value: string) => void;
  /** submit the goal from the input box or a sample chip */
  start: (text: string) => void;
  /** answer the current briefing question via a quick-reply chip */
  pickChip: (set: ChipSetId, label: string) => void;
  togglePlatform: (id: PlatformId) => void;
  confirmPlatforms: () => void;
  setActiveResult: (id: PlatformId) => void;
  reset: () => void;
}

export type Studio = StudioState & StudioActions;

/**
 * Conversational creation flow:
 * idle → audience → platform → style → materials → generating → done
 *
 * Mirrors the design prototype's DCLogic component, including its timing
 * (typing delays, 160ms progress ticks). Generation is simulated client-side;
 * the real AI agents will replace `finishGeneration` content via
 * `POST /api/generate` (see src/lib/generation.ts).
 */
export function useStudio(): Studio {
  const [phase, setPhase] = useState<StudioPhase>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState("");
  const [brief, setBrief] = useState<Brief>(EMPTY_BRIEF);
  const [selectedPlatforms, setSelectedPlatforms] = useState<PlatformId[]>([]);
  const [experts, setExperts] = useState<ExpertProgress[]>([]);
  const [activeResult, setActiveResult] = useState<PlatformId>("xhs");

  const idRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finishedRef = useRef(false);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const delay = useCallback((fn: () => void, ms: number) => {
    timersRef.current.push(setTimeout(fn, ms));
  }, []);

  const nextId = () => `m${idRef.current++}`;

  const pushUser = useCallback((text: string) => {
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "user", text, chipSet: null, locked: false },
    ]);
  }, []);

  const pushAi = useCallback(
    (text: string, chipSet: ChipSetId | null = null, ms = 850) => {
      setTyping(true);
      delay(() => {
        setTyping(false);
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "ai", text, chipSet, locked: false },
        ]);
      }, ms);
    },
    [delay],
  );

  const lockChips = useCallback(() => {
    setMessages((prev) =>
      prev.map((m) => (m.chipSet ? { ...m, locked: true } : m)),
    );
  }, []);

  const start = useCallback(
    (text: string) => {
      const goal = text.trim();
      if (!goal || phase !== "idle") return;
      pushUser(goal);
      setInput("");
      setPhase("audience");
      setBrief((b) => ({ ...b, goal }));
      pushAi("收到！听起来是个不错的 campaign。这次内容主要想触达谁？", "audience");
    },
    [phase, pushAi, pushUser],
  );

  const finishGeneration = useCallback(
    (platforms: PlatformId[]) => {
      const first = platforms[0] ?? "xhs";
      const n = platforms.length;
      setPhase("done");
      setActiveResult(first);
      pushAi(
        `搞定！${n} 位专家共交付 ${n} 篇内容，每篇都按平台规则调优过 → 看右侧结果区。还想改哪里，直接告诉我。`,
        null,
        600,
      );
    },
    [pushAi],
  );

  const startGeneration = useCallback(
    (platforms: PlatformId[]) => {
      finishedRef.current = false;
      setPhase("generating");
      setExperts(platforms.map((id) => ({ ...getPlatform(id), pct: 0 })));
      intervalRef.current = setInterval(() => {
        setExperts((prev) => {
          const next = prev.map((e) => ({
            ...e,
            pct: Math.min(100, e.pct + 1.5 + Math.random() * 5),
          }));
          if (!finishedRef.current && next.every((e) => e.pct >= 100)) {
            finishedRef.current = true;
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
            delay(() => finishGeneration(platforms), 500);
          }
          return next;
        });
      }, 160);
    },
    [delay, finishGeneration],
  );

  const pickChip = useCallback(
    (set: ChipSetId, label: string) => {
      if (set === "audience" && phase === "audience") {
        lockChips();
        pushUser(label);
        setPhase("platform");
        setBrief((b) => ({ ...b, audience: label }));
        pushAi(
          "明白。想发到哪些平台？可以多选——每个平台都会由专属专家来写。",
          "platforms",
        );
      } else if (set === "style" && phase === "style") {
        lockChips();
        pushUser(label);
        setPhase("materials");
        setBrief((b) => ({ ...b, style: label }));
        pushAi(
          "最后一个问题：手头有什么素材？没有也没关系，我可以帮你补全。",
          "materials",
        );
      } else if (set === "materials" && phase === "materials") {
        lockChips();
        pushUser(label);
        // platforms were locked in during confirmPlatforms; snapshot them here
        // so the timer is scheduled outside the state updater (updaters must
        // stay pure — StrictMode double-invokes them).
        const platforms = brief.platforms;
        setBrief((b) => ({ ...b, materials: label }));
        pushAi("简报齐了！正在派单给对应平台的专家团，请稍等几秒…", null, 700);
        delay(() => startGeneration(platforms), 1400);
      }
    },
    [phase, brief.platforms, lockChips, pushAi, pushUser, delay, startGeneration],
  );

  const togglePlatform = useCallback(
    (id: PlatformId) => {
      if (phase !== "platform") return;
      setSelectedPlatforms((prev) =>
        prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
      );
    },
    [phase],
  );

  const confirmPlatforms = useCallback(() => {
    if (phase !== "platform" || selectedPlatforms.length === 0) return;
    const names = selectedPlatforms
      .map((id) => getPlatform(id).name)
      .join("、");
    lockChips();
    pushUser(`平台：${names}`);
    setPhase("style");
    setBrief((b) => ({ ...b, platforms: [...selectedPlatforms] }));
    pushAi("好选择。这次内容想要什么风格调性？", "style");
  }, [phase, selectedPlatforms, lockChips, pushAi, pushUser]);

  const reset = useCallback(() => {
    clearTimers();
    finishedRef.current = false;
    setPhase("idle");
    setMessages([]);
    setTyping(false);
    setInput("");
    setBrief(EMPTY_BRIEF);
    setSelectedPlatforms([]);
    setExperts([]);
    setActiveResult("xhs");
  }, [clearTimers]);

  return {
    phase,
    messages,
    typing,
    input,
    brief,
    selectedPlatforms,
    experts,
    activeResult,
    setInput,
    start,
    pickChip,
    togglePlatform,
    confirmPlatforms,
    setActiveResult,
    reset,
  };
}

export { CHIP_SETS, PLATFORMS };
