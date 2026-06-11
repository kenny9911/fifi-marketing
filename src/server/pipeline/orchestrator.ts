import type { PipelineStage, TaskBrief, TaskStatus } from "@/lib/api-types";
import { PIPELINE_STAGES } from "@/lib/api-types";
import { db } from "@/server/db";
import { emitEvent, setTaskStatus } from "@/server/pipeline/events";
import { searchStage } from "@/server/pipeline/stages/search";
import { promptCraftStage } from "@/server/pipeline/stages/promptCraft";
import { craftStage } from "@/server/pipeline/stages/craft";
import { organizeStage } from "@/server/pipeline/stages/organize";
import { criticStage, type Critique } from "@/server/pipeline/stages/critic";
import { reviewStage, type ReviewDecision } from "@/server/pipeline/stages/review";
import { reeditStage } from "@/server/pipeline/stages/reedit";
import { finalizeStage, maybeAutoEvolve } from "@/server/pipeline/stages/finalize";
import { getPlatform } from "@/lib/platforms";
import { loadLatestDrafts, type StageCtx } from "@/server/pipeline/stages/common";
import type { PlatformId } from "@/lib/types";

const MAX_REVISION_CYCLES = 2;

const STAGE_LABEL = new Map<PipelineStage, string>(PIPELINE_STAGES.map((s) => [s.id, s.label]));

interface TaskRow {
  id: string;
  user_id: string;
  brief_json: string;
  status: TaskStatus;
}

function loadTask(taskId: string): TaskRow | undefined {
  return db
    .prepare<unknown[], TaskRow>("SELECT id, user_id, brief_json, status FROM tasks WHERE id = ?")
    .get(taskId);
}

/** Cancellation check between stages (SPEC §2). */
function bailIfCancelled(taskId: string): boolean {
  const row = db
    .prepare<unknown[], { status: TaskStatus }>("SELECT status FROM tasks WHERE id = ?")
    .get(taskId);
  if (!row) return true;
  if (row.status !== "cancelled") return false;
  emitEvent(taskId, {
    type: "pipeline_done",
    title: "任务已取消，流水线停止",
    detail: { cancelled: true },
  });
  return true;
}

async function withStage<T>(
  taskId: string,
  stage: PipelineStage,
  fn: () => Promise<T>,
): Promise<T> {
  const label = STAGE_LABEL.get(stage) ?? stage;
  setTaskStatus(taskId, "running", stage);
  emitEvent(taskId, { type: "stage_start", title: `${label} · 开始`, detail: { stage } });
  const t0 = Date.now();
  const result = await fn();
  const durationMs = Date.now() - t0;
  emitEvent(taskId, {
    type: "stage_done",
    title: `${label} · 完成 ${(durationMs / 1000).toFixed(1)}s`,
    detail: { stage, durationMs },
  });
  return result;
}

function buildCtx(task: TaskRow): StageCtx {
  const brief = JSON.parse(task.brief_json) as TaskBrief;
  return { taskId: task.id, userId: task.user_id, brief };
}

/**
 * Final transition, strictly after the finalize stage_done event so the SSE
 * stream never closes with unread rows: pipeline_done → terminal status
 * (`reviewing` when force-finalized with 残留问题) → auto-evolve hook.
 */
function concludePipeline(taskId: string, residualPlatforms: PlatformId[]): void {
  emitEvent(taskId, {
    type: "pipeline_done",
    agentId: "finalizer",
    title: residualPlatforms.length
      ? `交付完成（${residualPlatforms.map((p) => getPlatform(p).name).join("、")} 含残留问题，建议复核）`
      : "交付完成",
    detail: { residual: residualPlatforms },
  });
  setTaskStatus(taskId, residualPlatforms.length ? "reviewing" : "done", null);
  maybeAutoEvolve();
}

/**
 * Fire-and-forget pipeline entry: failures are caught, surfaced as an error
 * event and flip the task to `failed` (SPEC: only systemic failures do this —
 * per-platform failures are absorbed inside the stages).
 */
export function startPipeline(taskId: string): void {
  void runPipeline(taskId).catch((err) => {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[pipeline ${taskId}] fatal: ${reason}`);
    try {
      emitEvent(taskId, {
        type: "error",
        title: "流水线异常终止",
        detail: { text: reason },
      });
      emitEvent(taskId, { type: "pipeline_done", title: "任务失败", detail: { failed: true } });
      setTaskStatus(taskId, "failed", null, reason);
    } catch (inner) {
      console.error(`[pipeline ${taskId}] failed to record failure: ${inner}`);
    }
  });
}

/**
 * The 8-stage state machine (SPEC §2):
 * search → prompt_craft → craft → organize → critic → review
 *   → (revise? reedit → critic → review, max 2 cycles) → finalize.
 */
export async function runPipeline(taskId: string): Promise<void> {
  const task = loadTask(taskId);
  if (!task) throw new Error(`task ${taskId} not found`);
  const ctx = buildCtx(task);
  if (ctx.brief.platforms.length === 0) throw new Error("brief has no platforms");

  if (bailIfCancelled(taskId)) return;
  const research = await withStage(taskId, "search", () => searchStage(ctx));

  if (bailIfCancelled(taskId)) return;
  const packs = await withStage(taskId, "prompt_craft", () => promptCraftStage(ctx, research));

  if (bailIfCancelled(taskId)) return;
  let drafts = await withStage(taskId, "craft", () => craftStage(ctx, research, packs));

  if (bailIfCancelled(taskId)) return;
  drafts = await withStage(taskId, "organize", () => organizeStage(ctx, drafts));

  if (bailIfCancelled(taskId)) return;
  const critiques = await withStage(taskId, "critic", () =>
    criticStage(ctx, drafts, ctx.brief.platforms),
  );

  if (bailIfCancelled(taskId)) return;
  let decision = await withStage(taskId, "review", () => reviewStage(ctx, critiques, 0));

  let cycle = 0;
  while (decision.failing.length > 0 && cycle < MAX_REVISION_CYCLES) {
    cycle += 1;
    const failing = decision.failing;

    if (bailIfCancelled(taskId)) return;
    drafts = await withStage(taskId, "reedit", () => reeditStage(ctx, drafts, failing));

    if (bailIfCancelled(taskId)) return;
    const recheck = await withStage(taskId, "critic", () =>
      criticStage(ctx, drafts, failing.map((f) => f.platform)),
    );
    for (const [platform, critique] of recheck) critiques.set(platform, critique);

    if (bailIfCancelled(taskId)) return;
    decision = await withStage(taskId, "review", () => reviewStage(ctx, critiques, cycle));
  }

  if (bailIfCancelled(taskId)) return;
  const { residualPlatforms } = await withStage(taskId, "finalize", () =>
    finalizeStage(ctx, drafts, critiques, decision.failing),
  );
  concludePipeline(taskId, residualPlatforms);
}

/**
 * Targeted revision triggered by a user message on a done/reviewing task
 * (SPEC §5): reedit ALL platforms with the user's directive, then
 * critic → review → finalize.
 */
export async function runRevision(taskId: string, directive: string): Promise<void> {
  const task = loadTask(taskId);
  if (!task) throw new Error(`task ${taskId} not found`);
  const ctx = buildCtx(task);
  if (ctx.brief.platforms.length === 0) throw new Error("brief has no platforms");

  let drafts = loadLatestDrafts(taskId, ctx.brief.platforms);
  const failingAll: { platform: PlatformId; directives: string }[] = ctx.brief.platforms.map(
    (platform) => ({ platform, directives: directive }),
  );

  if (bailIfCancelled(taskId)) return;
  drafts = await withStage(taskId, "reedit", () => reeditStage(ctx, drafts, failingAll));

  if (bailIfCancelled(taskId)) return;
  const critiques: Map<PlatformId, Critique> = await withStage(taskId, "critic", () =>
    criticStage(ctx, drafts, ctx.brief.platforms),
  );

  if (bailIfCancelled(taskId)) return;
  const decision: ReviewDecision = await withStage(taskId, "review", () =>
    reviewStage(ctx, critiques, 0),
  );

  if (bailIfCancelled(taskId)) return;
  const { residualPlatforms } = await withStage(taskId, "finalize", () =>
    finalizeStage(ctx, drafts, critiques, decision.failing),
  );
  concludePipeline(taskId, residualPlatforms);
}

/** Fire-and-forget wrapper around runRevision with the same failure handling. */
export function startRevision(taskId: string, directive: string): void {
  void runRevision(taskId, directive).catch((err) => {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[pipeline ${taskId}] revision fatal: ${reason}`);
    try {
      emitEvent(taskId, { type: "error", title: "修订流程异常终止", detail: { text: reason } });
      emitEvent(taskId, { type: "pipeline_done", title: "修订失败", detail: { failed: true } });
      setTaskStatus(taskId, "failed", null, reason);
    } catch (inner) {
      console.error(`[pipeline ${taskId}] failed to record revision failure: ${inner}`);
    }
  });
}
