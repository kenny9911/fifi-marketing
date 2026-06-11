"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { useTaskStream } from "@/components/hooks/useTaskStream";
import type {
  FileDto,
  ImageArtifactDto,
  TaskBrief,
  TaskDetail,
  TaskStatus,
  TaskSummary,
} from "@/lib/api-types";
import type { PlatformId } from "@/lib/types";

export interface Workbench {
  tasks: TaskSummary[];
  tasksLoading: boolean;
  current: TaskDetail | null;
  stream: ReturnType<typeof useTaskStream>;
  files: FileDto[];
  create(brief: TaskBrief): Promise<TaskDetail>;
  start(): Promise<void>;
  load(id: string): Promise<void>;
  closeTask(): void;
  send(text: string): Promise<void>;
  cancel(): Promise<void>;
  remove(id: string): Promise<void>;
  uploadFile(f: File): Promise<void>;
  generateImage(platform: PlatformId): Promise<void>;
  refresh(): Promise<void>;
}

// Mirrors the server contract (stream route TERMINAL_STATUSES / orchestrator
// concludePipeline): `reviewing` is a terminal status — force-finalized
// deliveries with residual issues park there and the pipeline emits nothing
// more. Only `running` keeps the SSE stream attached.
const LIVE_STATUSES: readonly TaskStatus[] = ["running"];
const TERMINAL_STATUSES: readonly TaskStatus[] = [
  "done",
  "reviewing",
  "failed",
  "cancelled",
];

/** 文件提取轮询：每 2 秒一次，最多 60 秒（req 7）。 */
const FILE_POLL_MS = 2000;
const FILE_POLL_MAX = 30;

/**
 * The studio workbench: owns the task list, the open `TaskDetail` and its
 * live SSE stream, and merges the two so consumers render one coherent task.
 *
 * Lifecycle: create → start (status flips to running, stream attaches) →
 * stream emits events/status/usage → terminal status arrives → detail is
 * refetched for finals/images/promptPacks/cost and the list refreshes.
 * A message sent on a done/reviewing task triggers a revision: the refetched
 * detail flips back to running and the stream re-attaches automatically.
 */
export function useWorkbench(): Workbench {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [files, setFiles] = useState<FileDto[]>([]);
  const [streamTaskId, setStreamTaskId] = useState<string | null>(null);
  // attach 计数：回炉重写时任务 id 不变（done/reviewing → running），靠它
  // 强制 useTaskStream 重建 EventSource（旧连接收到 done 后已永久关闭）
  const [streamAttach, setStreamAttach] = useState(0);

  /** id of the open task — guards against stale async writes after load/close */
  const detailIdRef = useRef<string | null>(null);
  const finalizingRef = useRef(false);
  const filePollersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const stream = useTaskStream(streamTaskId, streamAttach);

  // ----- task list -----

  const refresh = useCallback(async () => {
    const list = await api.get<TaskSummary[]>("/api/tasks");
    setTasks(list);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await refresh();
      } catch {
        // 401 时 client-api 已经跳转登录页；其余错误留给空状态提示
      } finally {
        setTasksLoading(false);
      }
    })();
  }, [refresh]);

  // ----- current detail + stream wiring -----

  /** Adopt a detail as the open task and (re)wire the stream to it. */
  const applyDetail = useCallback((d: TaskDetail) => {
    detailIdRef.current = d.id;
    setDetail(d);
    if (LIVE_STATUSES.includes(d.status)) {
      setStreamTaskId(d.id);
      // 即使 id 没变也要重连：useTaskStream 以 ?since=<lastSeq> 续传，只补尾部
      setStreamAttach((n) => n + 1);
    } else {
      setStreamTaskId(null);
    }
  }, []);

  const refetchDetail = useCallback(
    async (id: string) => {
      const d = await api.get<TaskDetail>(`/api/tasks/${id}`);
      if (detailIdRef.current === id) applyDetail(d);
      return d;
    },
    [applyDetail],
  );

  // 流给出终态（done/reviewing/failed/cancelled）→ 重取详情拿定稿/配图/
  // 提示词包/成本，并刷新左侧任务列表。applyDetail 会顺带把 streamTaskId
  // 置回 null。
  useEffect(() => {
    if (!streamTaskId || !stream.status) return;
    if (!TERMINAL_STATUSES.includes(stream.status)) return;
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    const id = streamTaskId;
    void (async () => {
      try {
        await refetchDetail(id);
        await refresh();
      } catch {
        // 拉取失败：下一次 load/refresh 兜底
      } finally {
        finalizingRef.current = false;
      }
    })();
  }, [stream.status, streamTaskId, refetchDetail, refresh]);

  // 暴露给消费方的 current：基础详情 + 流式增量（事件按 seq 去重追加，
  // 状态/阶段/费用以流为准）
  const current = useMemo<TaskDetail | null>(() => {
    if (!detail) return null;
    if (!streamTaskId || streamTaskId !== detail.id) return detail;

    const seenSeq = new Set(detail.events.map((e) => e.seq));
    const newEvents = stream.events.filter((e) => !seenSeq.has(e.seq));
    const events =
      newEvents.length > 0
        ? [...detail.events, ...newEvents].sort((a, b) => a.seq - b.seq)
        : detail.events;

    const seenMsg = new Set(detail.messages.map((m) => m.id));
    const newMessages = stream.messages.filter((m) => !seenMsg.has(m.id));
    const messages =
      newMessages.length > 0 ? [...detail.messages, ...newMessages] : detail.messages;

    return {
      ...detail,
      events,
      messages,
      status: stream.status ?? detail.status,
      stage: stream.stage ?? detail.stage,
      costUsd: stream.liveUsage?.costUsd ?? detail.costUsd,
      tokens: stream.liveUsage
        ? stream.liveUsage.promptTokens + stream.liveUsage.completionTokens
        : detail.tokens,
    };
  }, [detail, streamTaskId, stream]);

  // ----- actions -----

  const create = useCallback(
    async (brief: TaskBrief): Promise<TaskDetail> => {
      const d = await api.post<TaskDetail>("/api/tasks", { brief });
      applyDetail(d);
      void refresh().catch(() => {});
      return d;
    },
    [applyDetail, refresh],
  );

  const start = useCallback(async () => {
    const id = detailIdRef.current;
    if (!id) throw new Error("请先创建或打开一个任务，再开始生成");
    // 乐观更新：立即进入 running 并接上事件流，202 回来前界面就动起来
    setDetail((d) => (d && d.id === id ? { ...d, status: "running" } : d));
    setStreamTaskId(id);
    setStreamAttach((n) => n + 1);
    try {
      await api.post(`/api/tasks/${id}/start`);
    } catch (err) {
      // 启动失败：以服务端状态为准回滚
      await refetchDetail(id).catch(() => {});
      throw err;
    }
  }, [refetchDetail]);

  const load = useCallback(
    async (id: string) => {
      detailIdRef.current = id; // 预占，防止并发 load 的旧结果回写
      setFiles([]);
      const d = await api.get<TaskDetail>(`/api/tasks/${id}`);
      if (detailIdRef.current !== id) return;
      applyDetail(d);
    },
    [applyDetail],
  );

  const closeTask = useCallback(() => {
    detailIdRef.current = null;
    setDetail(null);
    setStreamTaskId(null);
    setFiles([]);
  }, []);

  const send = useCallback(
    async (text: string) => {
      const id = detailIdRef.current;
      if (!id) throw new Error("请先打开一个任务，再发送消息");
      await api.post(`/api/tasks/${id}/message`, { text });
      // done/reviewing 状态下的消息会触发定向回炉重写：重取详情让状态翻回
      // running，applyDetail 随之重建事件流连接
      await refetchDetail(id).catch(() => {});
    },
    [refetchDetail],
  );

  const cancel = useCallback(async () => {
    const id = detailIdRef.current;
    if (!id) return;
    await api.post(`/api/tasks/${id}/cancel`);
    await refetchDetail(id).catch(() => {});
    void refresh().catch(() => {});
  }, [refetchDetail, refresh]);

  const remove = useCallback(
    async (id: string) => {
      await api.del(`/api/tasks/${id}`);
      if (detailIdRef.current === id) closeTask();
      await refresh();
    },
    [closeTask, refresh],
  );

  // ----- files (req 7) -----

  useEffect(() => {
    const pollers = filePollersRef.current;
    return () => {
      pollers.forEach(clearTimeout);
      pollers.clear();
    };
  }, []);

  const pollFile = useCallback((fileId: string) => {
    function tick(attempt: number) {
      if (attempt >= FILE_POLL_MAX) return; // 60 秒上限，状态停留为 extracting
      const timer = setTimeout(() => {
        filePollersRef.current.delete(fileId);
        void (async () => {
          try {
            const dto = await api.get<FileDto>(`/api/files/${fileId}`);
            setFiles((prev) => prev.map((f) => (f.id === fileId ? dto : f)));
            if (dto.status === "extracting") tick(attempt + 1);
          } catch {
            tick(attempt + 1); // 单次失败不放弃，预算内继续轮询
          }
        })();
      }, FILE_POLL_MS);
      filePollersRef.current.set(fileId, timer);
    }
    tick(0);
  }, []);

  const uploadFile = useCallback(
    async (f: File) => {
      const dto = await api.upload(f, detailIdRef.current ?? undefined);
      setFiles((prev) => [...prev, dto]);
      if (dto.status === "extracting") pollFile(dto.id);
    },
    [pollFile],
  );

  // ----- images (req 8) -----

  const generateImage = useCallback(
    async (platform: PlatformId) => {
      const id = detailIdRef.current;
      if (!id) throw new Error("请先打开一个任务，再生成配图");
      await api.post<ImageArtifactDto>("/api/images/generate", {
        taskId: id,
        platform,
      });
      await refetchDetail(id);
    },
    [refetchDetail],
  );

  return {
    tasks,
    tasksLoading,
    current,
    stream,
    files,
    create,
    start,
    load,
    closeTask,
    send,
    cancel,
    remove,
    uploadFile,
    generateImage,
    refresh,
  };
}
