"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ChatMessageDto,
  PipelineStage,
  StreamPayload,
  TaskEventDto,
  TaskStatus,
  UsageTotals,
} from "@/lib/api-types";

export interface TaskStream {
  events: TaskEventDto[];
  status: TaskStatus | null;
  stage: PipelineStage | null;
  liveUsage: UsageTotals | null;
  messages: ChatMessageDto[];
  connected: boolean;
}

const MAX_RETRIES = 5;

const EMPTY_STREAM: TaskStream = {
  events: [],
  status: null,
  stage: null,
  liveUsage: null,
  messages: [],
  connected: false,
};

/**
 * SSE consumer for GET /api/tasks/:id/stream (payloads per `StreamPayload`).
 *
 * - EventSource is same-origin, so the session cookie rides along for free.
 * - Events are deduped by `seq` (the server replays history on connect);
 *   messages are deduped by id.
 * - On connection errors it reconnects with `?since=<lastSeq>` so only the
 *   tail is replayed — up to 5 retries with exponential backoff.
 * - A `{ kind: "done" }` payload ends the stream for good (the server sends
 *   it strictly after the task reaches a terminal status).
 * - State is keyed by taskId: switching tasks (or passing `null`) exposes a
 *   fresh empty stream immediately, with no stale carry-over.
 * - `attachKey` forces a re-attach to the SAME task: a revision restarted on a
 *   done/reviewing task needs a new EventSource even though taskId never
 *   changed (the previous effect saw `{ kind: "done" }` and closed for good).
 *   The reconnect resumes from the last seen seq, so only the tail replays.
 */
export function useTaskStream(taskId: string | null, attachKey = 0): TaskStream {
  // 状态随 taskId 成键存储；渲染时按当前 taskId 取值，切换任务即自然归零
  const [snap, setSnap] = useState<{ id: string | null; stream: TaskStream }>({
    id: null,
    stream: EMPTY_STREAM,
  });
  // 跨 attach 续传游标：同一任务重连时带上 ?since=<lastSeq>，避免重放已有事件
  const cursorRef = useRef<{ id: string | null; seq: number }>({ id: null, seq: 0 });

  useEffect(() => {
    if (!taskId) return;

    if (cursorRef.current.id !== taskId) cursorRef.current = { id: taskId, seq: 0 };
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retries = 0;
    let lastSeq = cursorRef.current.seq;
    let done = false;
    let disposed = false;
    const seenSeq = new Set<number>();
    const seenMsg = new Set<string>();

    /** Update this task's stream state, discarding any other task's leftovers. */
    const patch = (fn: (s: TaskStream) => TaskStream) => {
      setSnap((prev) => ({
        id: taskId,
        stream: fn(prev.id === taskId ? prev.stream : EMPTY_STREAM),
      }));
    };

    const closeSource = () => {
      if (es) {
        es.close();
        es = null;
      }
    };

    const handlePayload = (payload: StreamPayload) => {
      switch (payload.kind) {
        case "event": {
          const ev = payload.event;
          if (ev.seq > lastSeq) {
            lastSeq = ev.seq;
            cursorRef.current = { id: taskId, seq: ev.seq };
          }
          if (seenSeq.has(ev.seq)) return;
          seenSeq.add(ev.seq);
          patch((s) => {
            const last = s.events[s.events.length - 1];
            const events =
              !last || last.seq < ev.seq
                ? [...s.events, ev]
                : // 极端乱序兜底：插入后按 seq 重排
                  [...s.events, ev].sort((a, b) => a.seq - b.seq);
            return { ...s, events };
          });
          return;
        }
        case "status":
          patch((s) => ({ ...s, status: payload.status, stage: payload.stage }));
          return;
        case "message": {
          const msg = payload.message;
          if (seenMsg.has(msg.id)) return;
          seenMsg.add(msg.id);
          patch((s) => ({ ...s, messages: [...s.messages, msg] }));
          return;
        }
        case "usage":
          patch((s) => ({ ...s, liveUsage: payload.usage }));
          return;
        case "done":
          // 流水线收尾：服务端在终态之后才发 done，可以安全断开
          done = true;
          closeSource();
          patch((s) => ({ ...s, connected: false }));
          return;
      }
    };

    // 新连接以服务端为准：清掉上一段连接残留的 status/stage/usage（重连后的
    // 第一个 status 包随即覆盖）；事件与消息保留，按 seq/id 去重只补尾部。
    patch((s) => ({ ...s, status: null, stage: null, liveUsage: null }));

    const connect = () => {
      if (disposed || done) return;
      const url =
        lastSeq > 0
          ? `/api/tasks/${taskId}/stream?since=${lastSeq}`
          : `/api/tasks/${taskId}/stream`;
      es = new EventSource(url);
      es.onopen = () => {
        retries = 0;
        patch((s) => ({ ...s, connected: true }));
      };
      es.onmessage = (e: MessageEvent<string>) => {
        let payload: StreamPayload;
        try {
          payload = JSON.parse(e.data) as StreamPayload;
        } catch {
          return; // 心跳/非 JSON 行直接忽略
        }
        handlePayload(payload);
      };
      es.onerror = () => {
        closeSource();
        if (disposed || done) return;
        patch((s) => ({ ...s, connected: false }));
        if (retries >= MAX_RETRIES) return;
        const wait = Math.min(800 * 2 ** retries, 8000);
        retries += 1;
        retryTimer = setTimeout(connect, wait);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      closeSource();
    };
  }, [taskId, attachKey]);

  return snap.id === taskId ? snap.stream : EMPTY_STREAM;
}
