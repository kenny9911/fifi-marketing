import type {
  ChatMessageDto,
  PipelineStage,
  StreamPayload,
  TaskStatus,
} from "@/lib/api-types";
import { handle, requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { eventRowToDto, getOwnedTask, taskUsageTotals, type EventRow } from "@/server/tasks";

const POLL_MS = 700;
const HEARTBEAT_MS = 15_000;

/** Statuses after which the pipeline emits nothing more. */
const TERMINAL_STATUSES: TaskStatus[] = ["done", "reviewing", "failed", "cancelled"];

interface MessageRow {
  rid: number;
  id: string;
  role: "user" | "ai" | "system";
  text: string;
  meta_json: string;
  created_at: string;
}

function eventsAfter(taskId: string, afterSeq: number): EventRow[] {
  return db
    .prepare<unknown[], EventRow>(
      `SELECT e.seq, e.ts, e.type, e.agent_id, e.title, e.detail_json, a.name AS agent_name
         FROM task_events e LEFT JOIN agents a ON a.id = e.agent_id
        WHERE e.task_id = ? AND e.seq > ?
        ORDER BY e.seq`,
    )
    .all(taskId, afterSeq);
}

function messagesAfter(taskId: string, afterRowid: number): MessageRow[] {
  return db
    .prepare<unknown[], MessageRow>(
      "SELECT rowid AS rid, id, role, text, meta_json, created_at FROM messages WHERE task_id = ? AND rowid > ? ORDER BY rowid",
    )
    .all(taskId, afterRowid);
}

function maxMessageRowid(taskId: string): number {
  const row = db
    .prepare<unknown[], { m: number }>(
      "SELECT COALESCE(MAX(rowid), 0) AS m FROM messages WHERE task_id = ?",
    )
    .get(taskId);
  return row?.m ?? 0;
}

/**
 * GET /api/tasks/:id/stream — SSE per SPEC §5: replays events after `?since=`,
 * then polls task_events/tasks/messages every 700ms; heartbeat comment every
 * 15s; closes with a final usage payload once the task reaches a terminal
 * status. The orchestrator sets the terminal status strictly after emitting
 * pipeline_done, so the closing sweep still delivers it — and a pipeline_done
 * replayed from an earlier run (e.g. `since=0` on a task re-running a
 * revision) does NOT close the stream while status is `running`.
 */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const task = getOwnedTask(id, user);

  const url = new URL(req.url);
  const since = Math.max(0, Number(url.searchParams.get("since")) || 0);

  const encoder = new TextEncoder();
  let cleanupFn: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let lastSeq = since;
      // Only stream messages created after connect — history comes from GET /api/tasks/:id.
      let lastMsgRowid = maxMessageRowid(task.id);
      let lastStatusKey = "";
      let lastUsageKey = "";
      let closed = false;
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let hbTimer: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (pollTimer) clearInterval(pollTimer);
        if (hbTimer) clearInterval(hbTimer);
        try {
          controller.close();
        } catch {
          // already closed/cancelled
        }
      };
      cleanupFn = cleanup;

      const write = (payload: StreamPayload) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          cleanup();
        }
      };

      const heartbeat = () => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": hb\n\n"));
        } catch {
          cleanup();
        }
      };

      const pushEvents = () => {
        for (const row of eventsAfter(task.id, lastSeq)) {
          lastSeq = row.seq;
          write({ kind: "event", event: eventRowToDto(row) });
        }
      };

      const pushMessages = () => {
        for (const row of messagesAfter(task.id, lastMsgRowid)) {
          lastMsgRowid = row.rid;
          let meta: Record<string, unknown> | undefined;
          try {
            meta = JSON.parse(row.meta_json) as Record<string, unknown>;
          } catch {
            meta = undefined;
          }
          const message: ChatMessageDto = {
            id: row.id,
            role: row.role,
            text: row.text,
            meta,
            createdAt: row.created_at,
          };
          write({ kind: "message", message });
        }
      };

      const pushStatus = (): boolean => {
        const row = db
          .prepare<unknown[], { status: TaskStatus; stage: PipelineStage | null }>(
            "SELECT status, stage FROM tasks WHERE id = ?",
          )
          .get(task.id);
        if (!row) return true;
        const key = `${row.status}|${row.stage ?? ""}`;
        if (key !== lastStatusKey) {
          lastStatusKey = key;
          write({ kind: "status", status: row.status, stage: row.stage ?? null });
        }
        return TERMINAL_STATUSES.includes(row.status);
      };

      const pushUsage = (force: boolean) => {
        const usage = taskUsageTotals(task.id);
        const key = `${usage.calls}|${usage.costUsd}|${usage.promptTokens + usage.completionTokens}`;
        if (force || key !== lastUsageKey) {
          lastUsageKey = key;
          write({ kind: "usage", usage });
        }
      };

      const tick = () => {
        if (closed) return;
        try {
          pushEvents();
          pushMessages();
          const terminal = pushStatus();
          pushUsage(false);
          if (terminal) {
            pushEvents(); // sweep rows written between the events and status reads (incl. pipeline_done)
            pushMessages();
            pushUsage(true); // final task-scoped usage total
            write({ kind: "done" });
            cleanup();
          }
        } catch (err) {
          console.warn(`[stream ${task.id}] tick failed: ${err}`);
          cleanup();
        }
      };

      // Initial replay (events > since, current status + usage); closes
      // immediately for already-finished tasks.
      tick();
      if (!closed) {
        pollTimer = setInterval(tick, POLL_MS);
        hbTimer = setInterval(heartbeat, HEARTBEAT_MS);
        req.signal.addEventListener("abort", cleanup);
      }
    },
    cancel() {
      cleanupFn();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
});
