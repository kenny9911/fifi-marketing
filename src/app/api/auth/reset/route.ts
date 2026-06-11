import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { generateRecoveryCode, hashSecret, verifySecret } from "@/server/crypto";
import { ApiError, handle, readJson } from "@/server/auth";
import type { UserRow } from "@/server/auth";

const resetSchema = z.object({
  username: z.string().min(1, "请输入用户名"),
  recoveryCode: z.string().min(1, "请输入恢复码"),
  newPassword: z.string().min(8, "新密码至少 8 位"),
});

/** Verified against when user/recovery hash is missing, to equalize timing. */
const DUMMY_HASH = hashSecret("fifi-dummy-recovery-pad");

export const POST = handle(async (req) => {
  const body = resetSchema.parse(await readJson(req));

  const row = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(body.username) as UserRow | undefined;
  const ok =
    verifySecret(body.recoveryCode.trim().toUpperCase(), row?.recovery_code_hash ?? DUMMY_HASH) &&
    !!row;
  if (!ok || !row) throw new ApiError(401, "用户名或恢复码错误");

  // Set the new password and ROTATE the recovery code (old one is spent).
  const nextCode = generateRecoveryCode();
  db.prepare("UPDATE users SET password_hash = ?, recovery_code_hash = ? WHERE id = ?").run(
    hashSecret(body.newPassword),
    hashSecret(nextCode),
    row.id,
  );

  return NextResponse.json({ ok: true, recoveryCode: nextCode });
});
