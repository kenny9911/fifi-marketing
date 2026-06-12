/**
 * USD→CNY exchange rate for cost display.
 *
 * Tries free ECB/mid-market sources (same mid-market basis xe.com shows),
 * caches in-process for 12h, and falls back to the fixed 1:6.8 rate when no
 * live source is reachable. Display-only — the ledger stays in USD.
 */

export interface FxRate {
  base: "USD";
  quote: "CNY";
  rate: number;
  source: "live" | "fallback";
  fetchedAt: string;
}

const FALLBACK_RATE = 6.8;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

interface FxCache {
  rate: FxRate;
  expiresAt: number;
}

const globalFx = globalThis as unknown as { __fifiFxCache?: FxCache };

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchLiveRate(): Promise<number | null> {
  // Source 1: open.er-api.com (no key, daily refresh)
  try {
    const data = (await fetchJson("https://open.er-api.com/v6/latest/USD")) as {
      result?: unknown;
      rates?: { CNY?: unknown };
    };
    const rate = Number(data?.rates?.CNY);
    if (data?.result === "success" && Number.isFinite(rate) && rate > 0) return rate;
  } catch (err) {
    console.warn(
      `[fx] er-api failed: ${err instanceof Error ? err.message : err}`,
    );
  }
  // Source 2: frankfurter (ECB)
  try {
    const data = (await fetchJson(
      "https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY",
    )) as { rates?: { CNY?: unknown } };
    const rate = Number(data?.rates?.CNY);
    if (Number.isFinite(rate) && rate > 0) return rate;
  } catch (err) {
    console.warn(
      `[fx] frankfurter failed: ${err instanceof Error ? err.message : err}`,
    );
  }
  return null;
}

/** Cached USD→CNY rate; never throws. */
export async function getUsdCnyRate(): Promise<FxRate> {
  const cached = globalFx.__fifiFxCache;
  if (cached && cached.expiresAt > Date.now()) return cached.rate;

  if (process.env.TEST_MODE === "mock") {
    const rate: FxRate = {
      base: "USD",
      quote: "CNY",
      rate: FALLBACK_RATE,
      source: "fallback",
      fetchedAt: new Date().toISOString(),
    };
    globalFx.__fifiFxCache = { rate, expiresAt: Date.now() + CACHE_TTL_MS };
    return rate;
  }

  const live = await fetchLiveRate();
  const rate: FxRate = {
    base: "USD",
    quote: "CNY",
    rate: live ? Math.round(live * 10_000) / 10_000 : FALLBACK_RATE,
    source: live ? "live" : "fallback",
    fetchedAt: new Date().toISOString(),
  };
  // Cache failures for a shorter window so a transient outage recovers quickly.
  globalFx.__fifiFxCache = {
    rate,
    expiresAt: Date.now() + (live ? CACHE_TTL_MS : 10 * 60 * 1000),
  };
  return rate;
}
