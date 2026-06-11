import { NextResponse } from "next/server";
import { generateContent, type GenerationRequest } from "@/lib/generation";

/**
 * Generation endpoint stub.
 *
 * This is where the AI expert agents will plug in: the brief comes in, each
 * selected platform's agent (桃桃/阿飞/文叔/…) produces platform-tuned content
 * via LLM calls, and results stream back to the studio. For now it returns the
 * canned demo content so the frontend contract is already exercised end to end.
 */
export async function POST(request: Request) {
  let body: GenerationRequest;
  try {
    body = (await request.json()) as GenerationRequest;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!body?.brief?.platforms?.length) {
    return NextResponse.json(
      { error: "brief.platforms must be a non-empty array" },
      { status: 400 },
    );
  }

  const response = await generateContent(body);
  return NextResponse.json(response);
}
