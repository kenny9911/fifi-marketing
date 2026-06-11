import { NextResponse } from "next/server";
import { z } from "zod";
import { db, uid, nowIso } from "@/server/db";
import { hashSecret, generateRecoveryCode } from "@/server/crypto";
import { ApiError, handle, issueSession, readJson, toUserDto } from "@/server/auth";
import type { UserRow } from "@/server/auth";
import type { RegisterResponse } from "@/lib/api-types";

const registerSchema = z.object({
  username: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{3,32}$/, "用户名需为 3-32 位字母、数字、下划线或连字符"),
  password: z.string().min(8, "密码至少 8 位"),
  displayName: z.string().trim().min(1, "昵称不能为空").max(64, "昵称过长").optional(),
});

export const POST = handle(async (req) => {
  const body = registerSchema.parse(await readJson(req));

  const existing = db
    .prepare("SELECT id FROM users WHERE username = ?")
    .get(body.username) as { id: string } | undefined;
  if (existing) throw new ApiError(409, "用户名已存在");

  const recoveryCode = generateRecoveryCode();
  const id = uid();
  const now = nowIso();
  try {
    // Self-registration always creates a regular user; admins are provisioned
    // only via the seeded admin account (never auto-promoted).
    db.prepare(
      `INSERT INTO users (id, username, display_name, password_hash, recovery_code_hash, role, settings_json, created_at)
       VALUES (?, ?, ?, ?, ?, 'user', '{}', ?)`,
    ).run(
      id,
      body.username,
      body.displayName ?? body.username,
      hashSecret(body.password),
      hashSecret(recoveryCode),
      now,
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes("UNIQUE")) {
      throw new ApiError(409, "用户名已存在");
    }
    throw err;
  }

  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
  await issueSession(row.id);

  const payload: RegisterResponse = { user: toUserDto(row), recoveryCode };
  return NextResponse.json(payload, { status: 201 });
});
