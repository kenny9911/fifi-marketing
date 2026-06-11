import { NextResponse } from "next/server";
import { getSessionUser, handle, toUserDtoWithAvatar } from "@/server/auth";

export const GET = handle(async () => {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ user: null });
  return NextResponse.json({ user: await toUserDtoWithAvatar(user) });
});
