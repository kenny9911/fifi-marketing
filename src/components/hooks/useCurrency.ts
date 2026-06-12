"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { FxRateDto } from "@/lib/api-types";

/**
 * Cost display currency (USD ⇄ CNY) — one module-level store so every cost
 * surface (usage dashboard, cost chip, sessions sidebar, settings) flips
 * together. The ledger itself stays in USD; CNY is display-only conversion
 * using the /api/fx mid-market rate (fallback fixed 6.8).
 */

export type Currency = "USD" | "CNY";

const STORAGE_KEY = "fifi-currency";
const FALLBACK_RATE = 6.8;

interface FxState {
  currency: Currency;
  rate: number;
  source: "live" | "fallback" | "pending";
}

const SERVER_SNAPSHOT: FxState = {
  currency: "USD",
  rate: FALLBACK_RATE,
  source: "pending",
};

let state: FxState = SERVER_SNAPSHOT;
let initialized = false;
let fxRequested = false;
const listeners = new Set<() => void>();

function emit(next: Partial<FxState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function initFromStorage() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "CNY" || stored === "USD") {
    state = { ...state, currency: stored };
  }
}

function ensureRate() {
  if (fxRequested || typeof window === "undefined") return;
  fxRequested = true;
  // Raw fetch on purpose: this is fire-and-forget and must never trigger the
  // api-client's 401 → /login redirect from a background refresh.
  fetch("/api/fx", { headers: { accept: "application/json" } })
    .then((res) => (res.ok ? (res.json() as Promise<FxRateDto>) : null))
    .then((fx) => {
      if (fx && Number.isFinite(fx.rate) && fx.rate > 0) {
        emit({ rate: fx.rate, source: fx.source });
      } else {
        emit({ source: "fallback" });
      }
    })
    .catch(() => emit({ source: "fallback" }));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): FxState {
  initFromStorage();
  return state;
}

export function setCurrency(currency: Currency) {
  if (currency === state.currency) return;
  emit({ currency });
  try {
    window.localStorage.setItem(STORAGE_KEY, currency);
  } catch {
    /* private mode etc. — in-memory state still applies */
  }
  // Best-effort sync into user settings (cross-device); silently ignore
  // failures — raw fetch to avoid the 401 redirect of the api client.
  void fetch("/api/profile", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ settings: { currency } }),
  }).catch(() => undefined);
}

/** Currency-aware money formatters mirroring the app's USD precision rules. */
export interface Money {
  currency: Currency;
  symbol: "$" | "¥";
  rate: number;
  source: FxState["source"];
  /** e.g. "实时汇率 1 USD ≈ 7.02 CNY" */
  rateLabel: string;
  convert(usd: number): number;
  fmt(usd: number, dp: number): string;
  /** 6dp ledger precision */
  cost(usd: number): string;
  /** 4dp */
  costShort(usd: number): string;
  /** big numbers: 2dp ≥100, else 4dp */
  costHero(usd: number): string;
  /** sidebar badges: 0 / <0.01 / 2dp */
  compact(usd: number): string;
}

export function useCurrency(): {
  currency: Currency;
  rate: number;
  source: FxState["source"];
  setCurrency: (c: Currency) => void;
  toggle: () => void;
  money: Money;
} {
  const snap = useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);

  useEffect(() => {
    ensureRate();
  }, []);

  const money = useMemo<Money>(() => {
    const { currency, rate, source } = snap;
    const symbol = currency === "USD" ? "$" : "¥";
    const convert = (usd: number) => (currency === "USD" ? usd : usd * rate);
    const fmt = (usd: number, dp: number) => `${symbol}${convert(usd).toFixed(dp)}`;
    const rateLabel =
      source === "live"
        ? `实时汇率 1 USD ≈ ${rate.toFixed(4)} CNY（中间价，每 12 小时更新）`
        : source === "fallback"
          ? `固定汇率 1 USD = ${rate} CNY（实时汇率不可用）`
          : `汇率获取中，按 1 USD = ${rate} CNY 预估`;
    return {
      currency,
      symbol,
      rate,
      source,
      rateLabel,
      convert,
      fmt,
      cost: (usd) => fmt(usd, 6),
      costShort: (usd) => fmt(usd, 4),
      costHero: (usd) => fmt(usd, convert(usd) >= 100 ? 2 : 4),
      compact: (usd) => {
        if (usd <= 0) return `${symbol}0`;
        const v = convert(usd);
        if (v < 0.01) return `<${symbol}0.01`;
        return `${symbol}${v.toFixed(2)}`;
      },
    };
  }, [snap]);

  return {
    currency: snap.currency,
    rate: snap.rate,
    source: snap.source,
    setCurrency,
    toggle: () => setCurrency(snap.currency === "USD" ? "CNY" : "USD"),
    money,
  };
}
