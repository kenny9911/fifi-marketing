/**
 * Cost helper: turns token counts into USD using the per-million pricing
 * stored on a `models` registry row.
 */

export interface ModelPricing {
  input_cost_per_m: number;
  output_cost_per_m: number;
}

export function costUsd(
  modelRow: ModelPricing | null | undefined,
  promptTokens: number,
  completionTokens: number,
): number {
  if (!modelRow) return 0;
  const raw =
    (promptTokens * (modelRow.input_cost_per_m || 0) +
      completionTokens * (modelRow.output_cost_per_m || 0)) /
    1_000_000;
  // Trim float noise; keep sub-cent precision for cheap models.
  return Math.round(raw * 1e8) / 1e8;
}
