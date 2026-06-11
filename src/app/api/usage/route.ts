import { ApiError, handle, requireUser } from "@/server/auth";
import { usageReport } from "@/server/usage";

const SCOPES = ["task", "daily", "weekly"] as const;
type Scope = (typeof SCOPES)[number];

/**
 * GET /api/usage (req 5)
 *   ?scope=task[&id=<taskId>]            — per-task buckets
 *   ?scope=daily|weekly[&days=N]         — time buckets
 * Own data by default; admins may pass &userId=<id> or &all=1 to widen the filter.
 */
export const GET = handle(async (req: Request) => {
  const user = await requireUser();
  const sp = new URL(req.url).searchParams;

  const scopeRaw = sp.get("scope") ?? "daily";
  if (!(SCOPES as readonly string[]).includes(scopeRaw)) {
    throw new ApiError(400, "scope 必须是 task / daily / weekly 之一");
  }
  const scope = scopeRaw as Scope;

  let days: number | undefined;
  const daysRaw = sp.get("days");
  if (daysRaw !== null && daysRaw !== "") {
    const n = Number(daysRaw);
    if (!Number.isFinite(n) || n <= 0 || n > 365) {
      throw new ApiError(400, "days 必须是 1-365 之间的数字");
    }
    days = Math.floor(n);
  }

  const taskId = sp.get("id") ?? sp.get("taskId") ?? undefined;

  // Default: own data only. Admin overrides: userId=<id> or all=1.
  let userId: string | undefined = user.id;
  const wantUserId = sp.get("userId");
  const wantAll = sp.get("all") === "1";
  if (wantUserId || wantAll) {
    if (user.role !== "admin") {
      throw new ApiError(403, "仅管理员可查询其他用户的用量");
    }
    userId = wantAll ? undefined : (wantUserId ?? undefined);
  }

  const report = usageReport({ scope, userId, taskId: taskId || undefined, days });
  return Response.json(report);
});
