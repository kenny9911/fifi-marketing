import { DEMO_RESULTS, type PlatformResult } from "./results";
import type { Brief, PlatformId } from "./types";

/**
 * Content-generation service boundary.
 *
 * Today this returns the canned demo content from `results.ts`. When the AI
 * agent backend lands, swap the body of `generateContent` for a call to
 * `POST /api/generate` (already stubbed) which will fan the brief out to the
 * per-platform expert agents and stream real results back. The studio UI only
 * depends on this function's signature.
 */

export interface GenerationRequest {
  brief: Brief;
}

export interface GenerationResponse {
  results: Partial<Record<PlatformId, PlatformResult>>;
}

export async function generateContent(
  request: GenerationRequest,
): Promise<GenerationResponse> {
  const results: GenerationResponse["results"] = {};
  for (const id of request.brief.platforms) {
    const canned = DEMO_RESULTS[id];
    if (canned) results[id] = canned;
  }
  return { results };
}
