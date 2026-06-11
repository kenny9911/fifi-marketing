import { NextResponse } from "next/server";
import { clearSession, handle } from "@/server/auth";

export const POST = handle(async () => {
  // Clear unconditionally: a stale/invalid cookie should still be removable.
  await clearSession();
  return NextResponse.json({ ok: true });
});
