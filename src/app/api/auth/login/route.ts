import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { hashSecret, verifySecret } from "@/server/crypto";
import { ApiError, handle, issueSession, readJson, toUserDto } from "@/server/auth";
import type { UserRow } from "@/server/auth";

const loginSchema = z.object({
  username: z.string().min(1, "请输入用户名"),
  password: z.string().min(1, "请输入密码"),
});

/** Verified against when the user does not exist, to equalize scrypt timing. */
const DUMMY_HASH = hashSecret("fifi-dummy-password-pad");

const MIN_RESPONSE_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * In-memory brute-force throttle: after MAX_FAILED_ATTEMPTS failures for the
 * same username+IP within LOCKOUT_WINDOW_MS, reject with 429 until the window
 * expires. Resets on successful login (and on process restart).
 */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const PRUNE_THRESHOLD = 1000;
const failedLogins = new Map<string, { count: number; firstAt: number }>();

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip") ?? "unknown";
}

function pruneFailedLogins(now: number): void {
  if (failedLogins.size < PRUNE_THRESHOLD) return;
  for (const [key, entry] of failedLogins) {
    if (now - entry.firstAt > LOCKOUT_WINDOW_MS) failedLogins.delete(key);
  }
}

export const POST = handle(async (req) => {
  const started = Date.now();
  const body = loginSchema.parse(await readJson(req));

  const throttleKey = `${clientIp(req)}|${body.username}`;
  const entry = failedLogins.get(throttleKey);
  if (entry && started - entry.firstAt > LOCKOUT_WINDOW_MS) {
    failedLogins.delete(throttleKey);
  } else if (entry && entry.count >= MAX_FAILED_ATTEMPTS) {
    throw new ApiError(429, "登录失败次数过多，请稍后再试");
  }

  const row = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(body.username) as UserRow | undefined;
  const ok = verifySecret(body.password, row?.password_hash ?? DUMMY_HASH) && !!row;

  // Constant ~300ms floor so timing reveals nothing about username/password.
  await sleep(Math.max(0, MIN_RESPONSE_MS - (Date.now() - started)));

  if (!ok || !row) {
    pruneFailedLogins(started);
    const current = failedLogins.get(throttleKey);
    if (current) current.count += 1;
    else failedLogins.set(throttleKey, { count: 1, firstAt: started });
    throw new ApiError(401, "用户名或密码错误");
  }

  failedLogins.delete(throttleKey);
  await issueSession(row.id);
  return NextResponse.json({ user: toUserDto(row) });
});
