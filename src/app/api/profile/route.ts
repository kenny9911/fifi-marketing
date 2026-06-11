import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { hashSecret, verifySecret } from "@/server/crypto";
import { ApiError, handle, readJson, requireUser, toUserDtoWithAvatar } from "@/server/auth";
import type { UserRow } from "@/server/auth";
import { PLATFORMS } from "@/lib/platforms";
import type { PlatformId } from "@/lib/types";
import type { UserSettings } from "@/lib/api-types";

const platformIds = PLATFORMS.map((p) => p.id) as [PlatformId, ...PlatformId[]];

const putSchema = z.object({
  displayName: z.string().trim().min(1, "昵称不能为空").max(64, "昵称过长").optional(),
  settings: z
    .looseObject({
      defaultPlatforms: z.array(z.enum(platformIds)).optional(),
      hintsEnabled: z.boolean().optional(),
      locale: z.enum(["zh", "en"]).optional(),
    })
    .optional(),
  password: z
    .object({
      current: z.string().min(1, "请输入当前密码"),
      next: z.string().min(8, "新密码至少 8 位"),
    })
    .optional(),
  avatarFileId: z.string().min(1).optional(),
});

export const GET = handle(async () => {
  const user = await requireUser();
  return NextResponse.json({ user: await toUserDtoWithAvatar(user) });
});

export const PUT = handle(async (req) => {
  const user = await requireUser();
  const body = putSchema.parse(await readJson(req));

  let displayName = user.display_name;
  let passwordHash = user.password_hash;
  let avatarKey = user.avatar_key;
  let settingsJson = user.settings_json;

  if (body.displayName !== undefined) {
    displayName = body.displayName;
  }

  if (body.settings !== undefined) {
    let current: UserSettings = {};
    try {
      current = JSON.parse(user.settings_json) as UserSettings;
    } catch {
      current = {};
    }
    settingsJson = JSON.stringify({ ...current, ...body.settings });
  }

  if (body.password !== undefined) {
    if (!verifySecret(body.password.current, user.password_hash)) {
      throw new ApiError(400, "当前密码不正确");
    }
    passwordHash = hashSecret(body.password.next);
  }

  if (body.avatarFileId !== undefined) {
    const file = db
      .prepare("SELECT minio_key FROM files WHERE id = ? AND user_id = ?")
      .get(body.avatarFileId, user.id) as { minio_key: string } | undefined;
    if (!file) throw new ApiError(404, "头像文件不存在");
    avatarKey = file.minio_key;
  }

  db.prepare(
    "UPDATE users SET display_name = ?, password_hash = ?, avatar_key = ?, settings_json = ? WHERE id = ?",
  ).run(displayName, passwordHash, avatarKey, settingsJson, user.id);

  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id) as UserRow;
  return NextResponse.json({ user: await toUserDtoWithAvatar(updated) });
});
