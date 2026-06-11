import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import { ZodError } from "zod";
import { db } from "./db";
import { getAuthSecretKey } from "./crypto";
import type { UserDto, UserSettings } from "@/lib/api-types";

export const SESSION_COOKIE = "fifi_session";
const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60; // 7 days

/** Row shape of the `users` table (see src/server/schema.sql). */
export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  recovery_code_hash: string | null;
  role: "user" | "admin";
  avatar_key: string | null;
  settings_json: string;
  created_at: string;
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Sign a 7d HS256 JWT {sub, role} and set it as the httpOnly session cookie. */
export async function issueSession(userId: string): Promise<void> {
  const row = db
    .prepare("SELECT id, role FROM users WHERE id = ?")
    .get(userId) as { id: string; role: string } | undefined;
  if (!row) throw new ApiError(500, "用户不存在");
  const token = await new SignJWT({ role: row.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(row.id)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getAuthSecretKey());
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Verify the session cookie and load the user row. Null on any failure. */
export async function getSessionUser(): Promise<UserRow | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getAuthSecretKey(), {
      algorithms: ["HS256"],
    });
    if (!payload.sub) return null;
    const row = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(payload.sub) as UserRow | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<UserRow> {
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, "未登录，请先登录");
  return user;
}

export async function requireAdmin(): Promise<UserRow> {
  const user = await requireUser();
  if (user.role !== "admin") throw new ApiError(403, "需要管理员权限");
  return user;
}

/** Map a users row to the client-safe UserDto (no hashes, no keys). */
export function toUserDto(row: UserRow): UserDto {
  let settings: UserSettings = {};
  try {
    settings = JSON.parse(row.settings_json) as UserSettings;
  } catch {
    settings = {};
  }
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    settings,
    createdAt: row.created_at,
  };
}

/** UserDto with a presigned avatar URL when the user has an avatar in MinIO. */
export async function toUserDtoWithAvatar(row: UserRow): Promise<UserDto> {
  const dto = toUserDto(row);
  if (row.avatar_key) {
    try {
      const { presignedGetUrl } = await import("./minio");
      dto.avatarUrl = await presignedGetUrl(row.avatar_key);
    } catch (err) {
      console.warn("[auth] failed to presign avatar url:", err);
    }
  }
  return dto;
}

/**
 * Route-handler wrapper: catches ApiError → {error} with its status,
 * ZodError → 400, anything else → 500.
 * `ctx` is `any` per the pinned cross-module contract (Next route ctx shape).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export function handle(
  fn: (req: Request, ctx: any) => Promise<Response>,
): (req: Request, ctx: any) => Promise<Response> {
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return async (req: Request, ctx: Parameters<typeof fn>[1]): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      if (err instanceof ZodError) {
        const issue = err.issues[0];
        const where = issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
        return NextResponse.json(
          { error: issue ? `${where}${issue.message}` : "请求参数无效" },
          { status: 400 },
        );
      }
      console.error("[api] unhandled error:", err);
      return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
    }
  };
}

/** Parse a JSON request body, mapping malformed JSON to a 400 ApiError. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError(400, "无效的 JSON 请求体");
  }
}
