import { NextResponse } from "next/server";
import { handle, requireUser } from "@/server/auth";
import { getUsdCnyRate } from "@/server/fx";

/** GET /api/fx — USD→CNY display rate (live mid-market, fallback 6.8). */
export const GET = handle(async () => {
  await requireUser();
  const rate = await getUsdCnyRate();
  return NextResponse.json(rate);
});
