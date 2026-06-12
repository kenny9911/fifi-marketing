#!/usr/bin/env node
/**
 * Use-case test suite for the FiFi agentic content pipeline (SPEC §7).
 *
 * Plain Node ESM, no framework (node >= 24). The suite:
 *   1. boots its own dev server (FIFI_DB_PATH=data/fifi-test.db TEST_MODE=mock
 *      PORT=3333) with logs piped to data/test-server.log,
 *   2. registers/logs in as `usecase-runner`,
 *   3. runs the 21 canonical use cases (3 per platform) with concurrency 3:
 *      create task → start → poll until terminal → assert finals / prompt
 *      packs / events / usage,
 *   4. cross-case asserts (task list, daily usage) + one multi-platform task,
 *   5. runs 6 behavior scenarios (cancel mid-run, revision via message,
 *      file-attach, auth boundaries, brief validation, weekly usage),
 *   6. prints a per-case PASS/FAIL table and "USECASES n/m PASSED".
 *
 * Mock mode makes every LLM/search/minio/image call a deterministic in-process
 * fixture: zero cost, no network, repeatable output. The server is ALWAYS
 * killed and data/fifi-test.db* removed on exit — including failures and ^C.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ===== Config =====

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3333;
const BASE = `http://localhost:${PORT}`;
const DB_REL = "data/fifi-test.db";
const DB = path.join(ROOT, DB_REL);
const LOG = path.join(ROOT, "data", "test-server.log");

const BOOT_TIMEOUT_MS = 90_000;
const CASE_TIMEOUT_MS = 120_000;
const POLL_MS = 1_000;
const CONCURRENCY = 3;

const USERNAME = "usecase-runner";
const PASSWORD = "Usecase-Runner-2026!";

/** stage_start events every successful pipeline run must contain. */
const REQUIRED_STAGES = ["search", "prompt_craft", "craft", "organize", "critic", "review", "finalize"];

/** finals[platform].kind per src/lib/results.ts: bespoke cards for xhs/dy/mp, generic otherwise. */
const KIND_FOR = (p) => (p === "xhs" || p === "dy" || p === "mp" ? p : "generic");
/** 专业种草 for the social/feed platforms, 专业解读 for the long-form ones. */
const STYLE_FOR = (p) => (["xhs", "dy", "wb"].includes(p) ? "专业种草" : "专业解读");

// ===== The 21 use cases (3 per platform), audience derived from each goal =====

const USE_CASES = [
  { p: "xhs", goal: "美妆品牌新款精华上市，想种草25-35岁敏感肌人群", audience: "25-35岁敏感肌人群" },
  { p: "xhs", goal: "社区健身房开业促销，吸引周边上班族办卡", audience: "周边上班族" },
  { p: "xhs", goal: "云南小众旅行攻略合集，面向预算有限的大学生", audience: "预算有限的大学生" },
  { p: "dy", goal: "新款降噪耳机开箱测评短视频，目标数码男青年", audience: "数码男青年" },
  { p: "dy", goal: "川菜馆探店视频，突出招牌菜和排队盛况", audience: "本地美食爱好者" },
  { p: "dy", goal: "一分钟讲懂个人所得税退税，面向职场新人", audience: "职场新人" },
  { p: "mp", goal: "SaaS公司年度行业白皮书解读长文，面向企业决策者", audience: "企业决策者" },
  { p: "mp", goal: "咖啡品牌创始人故事，建立品牌信任", audience: "关注品牌故事的咖啡爱好者" },
  { p: "mp", goal: "公司十周年用户答谢活动复盘，面向老客户", audience: "品牌老客户" },
  { p: "wb", goal: "借势世界杯热点推广运动饮料，年轻体育迷", audience: "年轻体育迷" },
  { p: "wb", goal: "手机品牌新品发布会话题预热，制造悬念", audience: "数码尝鲜人群" },
  { p: "wb", goal: "宠物食品品牌转发抽奖活动，扩大粉丝池", audience: "养宠人群" },
  { p: "zh", goal: "如何挑选第一台人体工学椅的专业回答，久坐程序员", audience: "久坐程序员" },
  { p: "zh", goal: "国产新能源车与特斯拉的客观对比测评", audience: "购车决策期消费者" },
  { p: "zh", goal: "2026年跨境电商行业趋势分析，面向创业者", audience: "跨境电商创业者" },
  { p: "bjh", goal: "本地汽车以旧换新政策解读资讯，面向有车家庭", audience: "有车家庭" },
  { p: "bjh", goal: "AI手机芯片行业资讯综述，科技关注者", audience: "科技关注者" },
  { p: "bjh", goal: "双十一家电消费避坑指南，价格敏感消费者", audience: "价格敏感消费者" },
  { p: "csdn", goal: "从零搭建RAG问答系统的实战教程，面向后端工程师", audience: "后端工程师" },
  { p: "csdn", goal: "Rust与Go在高并发服务下的对比实测", audience: "高并发服务后端工程师" },
  { p: "csdn", goal: "生产环境SQLite WAL模式踩坑复盘与解决方案", audience: "后端工程师与DBA" },
];

// ===== Tiny utilities =====

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Per-case assert collector: assert(name, cond, detail) → rows + boolean. */
function checker(rows) {
  return function assert(name, cond, detail) {
    rows.push({ name, ok: Boolean(cond), detail });
    return Boolean(cond);
  };
}

const nonEmptyStr = (v) => typeof v === "string" && v.trim().length > 0;
const nonEmptyStrArr = (v) => Array.isArray(v) && v.length > 0 && v.every(nonEmptyStr);

/** Promise pool: run fn over items with at most `limit` in flight. */
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const idx = next++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

// ===== Server lifecycle (always cleaned up) =====

let server = null;
let cleaned = false;

function removeDbFiles() {
  for (const suffix of ["", "-shm", "-wal", "-journal"]) {
    try {
      fs.rmSync(DB + suffix, { force: true });
    } catch {
      /* best effort */
    }
  }
}

function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (server && server.exitCode === null) {
    try {
      process.kill(-server.pid, "SIGTERM"); // whole group: npm + next
    } catch {
      try {
        server.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }
  }
  removeDbFiles();
}

process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    cleanup();
    process.exit(sig === "SIGINT" ? 130 : 143);
  });
}
process.on("uncaughtException", (err) => {
  console.error(`uncaught: ${err?.stack ?? err}`);
  cleanup();
  process.exit(1);
});

async function startServer() {
  // Fail fast if something else already answers on our port (next dev would
  // silently hop to another port and every request would hit the wrong app).
  try {
    await fetch(`${BASE}/api/auth/me`, { signal: AbortSignal.timeout(1_500) });
    throw new Error(`port ${PORT} is already in use — stop the other server first`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("already in use")) throw err;
    // connection refused → port free, proceed
  }

  removeDbFiles(); // stale DB from a crashed previous run
  fs.mkdirSync(path.dirname(DB), { recursive: true });
  const logFd = fs.openSync(LOG, "w");
  server = spawn("npm", ["run", "dev"], {
    cwd: ROOT,
    env: {
      ...process.env,
      FIFI_DB_PATH: DB_REL,
      TEST_MODE: "mock",
      PORT: String(PORT),
      // Own dist dir → own Next 16 dev-server lock, so the suite can run
      // alongside a regular `npm run dev` (which holds .next/dev/lock).
      NEXT_DIST_DIR: ".next-test",
    },
    stdio: ["ignore", logFd, logFd],
    detached: true, // own process group → we can kill npm AND next together
  });
  fs.closeSync(logFd);

  process.stdout.write(`booting dev server on :${PORT} (mock mode, db ${DB_REL}) `);
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  let lastErr = "no response yet";
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      let hint = "";
      try {
        const tail = fs.readFileSync(LOG, "utf8");
        if (tail.includes("already running")) {
          hint = " (another `next dev` holds this dist dir's lock — stop it or check .next-test/dev/lock)";
        }
      } catch {
        /* log unreadable — generic error below */
      }
      throw new Error(`dev server exited early (code ${server.exitCode})${hint} — see ${LOG}`);
    }
    try {
      const res = await fetch(`${BASE}/api/auth/me`, { signal: AbortSignal.timeout(5_000) });
      if (res.ok) {
        console.log(`— ready in ${((Date.now() - deadline + BOOT_TIMEOUT_MS) / 1000).toFixed(1)}s`);
        return;
      }
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err?.cause?.code ?? err?.message ?? String(err);
    }
    process.stdout.write(".");
    await sleep(500);
  }
  throw new Error(`dev server not ready within ${BOOT_TIMEOUT_MS / 1000}s (${lastErr}) — see ${LOG}`);
}

// ===== HTTP helpers (cookie-jar fetch) =====

let cookie = "";

async function req(method, urlPath, body, cookieOverride) {
  const headers = {};
  const jar = cookieOverride ?? cookie;
  if (jar) headers.cookie = jar;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(BASE + urlPath, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  for (const sc of res.headers.getSetCookie()) {
    if (sc.startsWith("fifi_session=")) cookie = sc.split(";")[0];
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body (error page etc.) — callers see raw text */
  }
  return { status: res.status, json, text };
}

/** Register usecase-runner; fall back to login if the account already exists. */
async function login() {
  const reg = await req("POST", "/api/auth/register", {
    username: USERNAME,
    password: PASSWORD,
    displayName: "用例跑批",
  });
  if (reg.status === 201) return;
  if (reg.status === 409) {
    const res = await req("POST", "/api/auth/login", { username: USERNAME, password: PASSWORD });
    if (res.status === 200) return;
    throw new Error(`login failed: HTTP ${res.status} ${res.text.slice(0, 200)}`);
  }
  throw new Error(`register failed: HTTP ${reg.status} ${reg.text.slice(0, 200)}`);
}

/** Poll GET /api/tasks/:id every POLL_MS until terminal status (or timeout). */
async function pollUntilTerminal(id, timeoutMs = CASE_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const res = await req("GET", `/api/tasks/${id}`);
    if (res.status === 200 && res.json) {
      last = res.json;
      if (last.status !== "briefing" && last.status !== "running") return last;
    }
    await sleep(POLL_MS);
  }
  return last; // non-terminal → the caller's terminal assert reports the actual status
}

/** Poll GET /api/tasks/:id until some event matches `pred` (or timeout). */
async function pollUntilEvent(id, pred, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const res = await req("GET", `/api/tasks/${id}`);
    if (res.status === 200 && res.json) {
      last = res.json;
      if (Array.isArray(last.events) && last.events.some(pred)) return last;
    }
    await sleep(500);
  }
  return last;
}

/**
 * Consume an SSE endpoint until the server closes it (or timeoutMs aborts).
 * Returns { status, payloads, closed } — `closed: true` only when the server
 * ended the stream itself, which is exactly what the cancel case asserts.
 */
async function readSse(urlPath, timeoutMs = 20_000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + urlPath, {
      headers: cookie ? { cookie } : {},
      signal: ac.signal,
    });
    const payloads = [];
    if (!res.ok || !res.body) return { status: res.status, payloads, closed: false };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const chunk = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue; // skip ": hb" heartbeats
          try {
            payloads.push(JSON.parse(line.slice(6)));
          } catch {
            /* malformed frame — surfaced by the payload asserts */
          }
        }
      }
    }
    return { status: res.status, payloads, closed: true };
  } catch (err) {
    return { status: 0, payloads: [], closed: false, error: err?.message ?? String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Register a throwaway user via raw fetch, WITHOUT touching the global cookie jar. */
async function registerIsolated(username, password) {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password, displayName: "边界测试用户" }),
  });
  let jar = "";
  for (const sc of res.headers.getSetCookie()) {
    if (sc.startsWith("fifi_session=")) jar = sc.split(";")[0];
  }
  return { status: res.status, jar };
}

// ===== Shared assertion blocks =====

function checkFinal(assert, platform, final) {
  const kind = KIND_FOR(platform);
  if (
    !assert(
      `finals.${platform} exists`,
      final && typeof final === "object",
      `finals[${platform}] missing`,
    )
  ) {
    return;
  }
  assert(`finals.${platform}.kind`, final.kind === kind, `expected "${kind}", got "${final.kind}"`);
  assert(`finals.${platform}.title non-empty`, nonEmptyStr(final.title), `got ${JSON.stringify(final.title)}`);
  if (kind === "xhs") {
    assert(`finals.${platform}.bodyLines non-empty`, nonEmptyStrArr(final.bodyLines), `got ${JSON.stringify(final.bodyLines)?.slice(0, 120)}`);
  } else if (kind === "dy") {
    const ok =
      Array.isArray(final.shots) && final.shots.length > 0 && final.shots.every((s) => s && nonEmptyStr(s.text));
    assert(`finals.${platform}.shots non-empty (each with text)`, ok, `got ${JSON.stringify(final.shots)?.slice(0, 120)}`);
  } else if (kind === "mp") {
    assert(`finals.${platform}.intro non-empty`, nonEmptyStr(final.intro), `got ${JSON.stringify(final.intro)}`);
    assert(`finals.${platform}.outline non-empty`, nonEmptyStrArr(final.outline), `got ${JSON.stringify(final.outline)?.slice(0, 120)}`);
  } else {
    assert(`finals.${platform}.sections non-empty`, nonEmptyStrArr(final.sections), `got ${JSON.stringify(final.sections)?.slice(0, 120)}`);
    assert(`finals.${platform} not an error placeholder`, final.error !== true, "final has error:true");
  }
}

function checkPacks(assert, platform, promptPacks) {
  const packs = Array.isArray(promptPacks) ? promptPacks : [];
  const have = packs.map((k) => `${k.kind}/${k.platform ?? "null"}`).join(", ") || "none";
  const text = packs.filter((k) => k.kind === "text" && k.platform === platform && nonEmptyStr(k.prompt));
  assert(`promptPacks: text for ${platform}`, text.length >= 1, `have: ${have}`);
  const image = packs.filter((k) => k.kind === "image" && nonEmptyStr(k.prompt));
  assert("promptPacks: image", image.length >= 1, `have: ${have}`);
  if (platform === "dy") {
    const video = packs.filter((k) => k.kind === "video" && nonEmptyStr(k.prompt));
    assert("promptPacks: video (dy)", video.length >= 1, `have: ${have}`);
  }
}

function checkEvents(assert, events) {
  const list = Array.isArray(events) ? events : [];
  const stages = new Set(
    list.filter((e) => e.type === "stage_start").map((e) => e.detail && e.detail.stage),
  );
  for (const s of REQUIRED_STAGES) {
    assert(`events: stage_start ${s}`, stages.has(s), `stage_start seen: ${[...stages].join(", ") || "none"}`);
  }
  const thinking = list.filter((e) => e.type === "thinking").length;
  assert("events: >=5 thinking", thinking >= 5, `got ${thinking}`);
  // A critic `review` event with a numeric score is written in the same stage
  // call that inserts the `reviews` row — it doubles as the reviews-row check.
  const scored = list.filter((e) => e.type === "review" && typeof e.detail?.score === "number");
  assert(
    "events: review event with numeric score (reviews row)",
    scored.length >= 1,
    `review events: ${list.filter((e) => e.type === "review").length}, with numeric score: ${scored.length}`,
  );
}

async function checkTaskUsage(assert, id) {
  const usage = await req("GET", `/api/usage?scope=task&id=${id}`);
  assert(
    "usage: scope=task totals.calls > 0",
    usage.status === 200 && usage.json?.totals?.calls > 0,
    `HTTP ${usage.status}, calls=${usage.json?.totals?.calls ?? "n/a"}`,
  );
}

// ===== Case runners =====

async function runCase(c, idx) {
  const rows = [];
  const assert = checker(rows);
  const t0 = Date.now();
  const label = `[${c.p}] ${c.goal}`;
  try {
    const brief = {
      goal: c.goal,
      audience: c.audience,
      platforms: [c.p],
      style: STYLE_FOR(c.p),
      materials: "无，请专家自行补全",
    };
    const created = await req("POST", "/api/tasks", { brief });
    if (!assert("create task", created.status === 200 && nonEmptyStr(created.json?.id), `HTTP ${created.status}: ${created.text.slice(0, 160)}`)) {
      return { label, rows, elapsedMs: Date.now() - t0 };
    }
    const id = created.json.id;

    const started = await req("POST", `/api/tasks/${id}/start`);
    assert("start → 202", started.status === 202, `HTTP ${started.status}: ${started.text.slice(0, 160)}`);

    const detail = await pollUntilTerminal(id);
    const terminal =
      detail && (detail.status === "done" || detail.status === "reviewing");
    assert(
      "terminal status done/reviewing",
      terminal,
      `status=${detail?.status ?? "no response"} stage=${detail?.stage ?? "-"} after ${CASE_TIMEOUT_MS / 1000}s`,
    );
    if (detail) {
      checkFinal(assert, c.p, detail.finals?.[c.p]);
      checkPacks(assert, c.p, detail.promptPacks);
      checkEvents(assert, detail.events);
      await checkTaskUsage(assert, id);
    }
  } catch (err) {
    assert(`case #${idx + 1} threw`, false, err?.message ?? String(err));
  }
  return { label, rows, elapsedMs: Date.now() - t0 };
}

/** Cross-case asserts — must run after the 21 cases but BEFORE the extra task. */
async function runCrossChecks() {
  const rows = [];
  const assert = checker(rows);
  const t0 = Date.now();
  try {
    const list = await req("GET", "/api/tasks");
    const count = Array.isArray(list.json) ? list.json.length : -1;
    assert("GET /api/tasks lists 21 tasks", list.status === 200 && count === USE_CASES.length, `HTTP ${list.status}, count=${count}`);

    const minCalls = USE_CASES.length * 6; // each single-platform run makes >=8 mock LLM calls
    const daily = await req("GET", "/api/usage?scope=daily&days=1");
    assert(
      `GET /api/usage?scope=daily&days=1 totals.calls >= ${minCalls}`,
      daily.status === 200 && daily.json?.totals?.calls >= minCalls,
      `HTTP ${daily.status}, calls=${daily.json?.totals?.calls ?? "n/a"}`,
    );
  } catch (err) {
    assert("cross checks threw", false, err?.message ?? String(err));
  }
  return { label: "[cross] task list + daily usage", rows, elapsedMs: Date.now() - t0 };
}

/** One extra multi-platform run: 4 finals, per-platform isolation. */
async function runMultiPlatform() {
  const rows = [];
  const assert = checker(rows);
  const t0 = Date.now();
  const platforms = ["xhs", "dy", "mp", "wb"];
  const label = "[multi] xhs+dy+mp+wb 全平台整合营销";
  try {
    const brief = {
      goal: "新品冻干速溶咖啡上市整合营销，多平台同步种草",
      audience: "25-35岁都市白领",
      platforms,
      style: "专业种草",
      materials: "无，请专家自行补全",
    };
    const created = await req("POST", "/api/tasks", { brief });
    if (!assert("create task", created.status === 200 && nonEmptyStr(created.json?.id), `HTTP ${created.status}: ${created.text.slice(0, 160)}`)) {
      return { label, rows, elapsedMs: Date.now() - t0 };
    }
    const id = created.json.id;
    const started = await req("POST", `/api/tasks/${id}/start`);
    assert("start → 202", started.status === 202, `HTTP ${started.status}`);

    const detail = await pollUntilTerminal(id);
    assert(
      "terminal status done/reviewing",
      detail && (detail.status === "done" || detail.status === "reviewing"),
      `status=${detail?.status ?? "no response"} stage=${detail?.stage ?? "-"}`,
    );
    if (detail) {
      const finals = detail.finals ?? {};
      assert("4 finals (one per platform)", Object.keys(finals).length === 4, `got: ${Object.keys(finals).join(", ") || "none"}`);
      for (const p of platforms) checkFinal(assert, p, finals[p]);

      // Per-platform isolation: each platform owns its text pack, and each
      // got its own critic review (event with platform + numeric score).
      const packs = Array.isArray(detail.promptPacks) ? detail.promptPacks : [];
      const events = Array.isArray(detail.events) ? detail.events : [];
      for (const p of platforms) {
        const textPacks = packs.filter((k) => k.kind === "text" && k.platform === p && nonEmptyStr(k.prompt));
        assert(`isolation: text pack scoped to ${p}`, textPacks.length >= 1, `text packs: ${packs.filter((k) => k.kind === "text").map((k) => k.platform).join(", ") || "none"}`);
        const reviews = events.filter(
          (e) => e.type === "review" && e.detail?.platform === p && typeof e.detail?.score === "number",
        );
        assert(`isolation: critic review for ${p}`, reviews.length >= 1, "no platform-scoped review event with score");
      }
      const videos = packs.filter((k) => k.kind === "video" && nonEmptyStr(k.prompt));
      assert("promptPacks: video (dy in selection)", videos.length >= 1, `kinds: ${packs.map((k) => k.kind).join(", ") || "none"}`);
      await checkTaskUsage(assert, id);
    }
  } catch (err) {
    assert("multi-platform case threw", false, err?.message ?? String(err));
  }
  return { label, rows, elapsedMs: Date.now() - t0 };
}

// ===== Behavior scenarios (SPEC §2 / §5 contracts the 21 cases don't touch) =====

/**
 * Cancel mid-run (SPEC §2/§5): the MOCK_SLOW marker in the goal stretches
 * every mock LLM call to ~250ms (see src/server/llm/client.ts), so the cancel
 * deterministically lands while the pipeline is still in flight. Asserts the
 * status flips to cancelled, the orchestrator bails between stages
 * (pipeline_done {cancelled:true}, no finalize, no finals) and a live SSE
 * stream closes with a `done` payload.
 */
async function runCancelMidRun() {
  const rows = [];
  const assert = checker(rows);
  const t0 = Date.now();
  const label = "[cancel] 运行中取消 → cancelled + SSE 关闭";
  try {
    const brief = {
      goal: "取消测试 MOCK_SLOW 慢速流水线",
      audience: "测试人群",
      platforms: ["xhs"],
      style: "专业种草",
      materials: "无",
    };
    const created = await req("POST", "/api/tasks", { brief });
    if (!assert("create task", created.status === 200 && nonEmptyStr(created.json?.id), `HTTP ${created.status}: ${created.text.slice(0, 160)}`)) {
      return { label, rows, elapsedMs: Date.now() - t0 };
    }
    const id = created.json.id;
    const started = await req("POST", `/api/tasks/${id}/start`);
    assert("start → 202", started.status === 202, `HTTP ${started.status}`);

    // Attach a live SSE stream, then cancel while the pipeline is mid-stage.
    const ssePromise = readSse(`/api/tasks/${id}/stream?since=0`);
    await sleep(300);
    const cancel = await req("POST", `/api/tasks/${id}/cancel`);
    assert(
      "cancel → 200 {status:'cancelled'}",
      cancel.status === 200 && cancel.json?.status === "cancelled",
      `HTTP ${cancel.status}: ${cancel.text.slice(0, 160)}`,
    );

    const sse = await ssePromise;
    assert("SSE stream closed by server", sse.closed, sse.error ?? `HTTP ${sse.status}, ${sse.payloads.length} payloads`);
    assert(
      "SSE final payload kind=done",
      sse.payloads.at(-1)?.kind === "done",
      `last payload: ${JSON.stringify(sse.payloads.at(-1))?.slice(0, 120)}`,
    );
    assert(
      "SSE saw status=cancelled",
      sse.payloads.some((p) => p.kind === "status" && p.status === "cancelled"),
      `status payloads: ${sse.payloads.filter((p) => p.kind === "status").map((p) => p.status).join(", ") || "none"}`,
    );

    // The orchestrator notices between stages: pipeline_done {cancelled:true}.
    const detail = await pollUntilEvent(id, (e) => e.type === "pipeline_done");
    const events = Array.isArray(detail?.events) ? detail.events : [];
    assert("status stays cancelled", detail?.status === "cancelled", `status=${detail?.status ?? "no response"}`);
    assert(
      "pipeline_done event with cancelled:true",
      events.some((e) => e.type === "pipeline_done" && e.detail?.cancelled === true),
      `pipeline_done details: ${JSON.stringify(events.filter((e) => e.type === "pipeline_done").map((e) => e.detail))}`,
    );
    const stages = events.filter((e) => e.type === "stage_start").map((e) => e.detail?.stage);
    assert("pipeline stopped before finalize", !stages.includes("finalize"), `stage_start seen: ${stages.join(", ")}`);
    assert("no finals published", Object.keys(detail?.finals ?? {}).length === 0, `finals: ${Object.keys(detail?.finals ?? {}).join(", ")}`);
  } catch (err) {
    assert("cancel case threw", false, err?.message ?? String(err));
  }
  return { label, rows, elapsedMs: Date.now() - t0 };
}

/**
 * Revision flow (SPEC §5): a user message on a done task is claimed as a
 * revision directive — status flips back to running, the reedit (回炉) stage
 * runs, a second critic/review/finalize pass publishes a NEW final version
 * and a second AI delivery summary.
 */
async function runRevisionFlow() {
  const rows = [];
  const assert = checker(rows);
  const t0 = Date.now();
  const label = "[revision] done 任务发消息 → 回炉重写出新版定稿";
  try {
    const brief = {
      goal: "修订流程测试：精华液种草笔记",
      audience: "敏感肌人群",
      platforms: ["xhs"],
      style: "专业种草",
      materials: "无",
    };
    const created = await req("POST", "/api/tasks", { brief });
    if (!assert("create task", created.status === 200 && nonEmptyStr(created.json?.id), `HTTP ${created.status}: ${created.text.slice(0, 160)}`)) {
      return { label, rows, elapsedMs: Date.now() - t0 };
    }
    const id = created.json.id;
    await req("POST", `/api/tasks/${id}/start`);
    const first = await pollUntilTerminal(id);
    if (!assert("first run reaches done", first?.status === "done", `status=${first?.status ?? "no response"}`)) {
      return { label, rows, elapsedMs: Date.now() - t0 };
    }
    const noteBefore = first.finals?.xhs?.tuningNotes?.[0] ?? "";
    assert("v1 final is not a reedit output", !noteBefore.includes("回炉"), `tuningNotes[0]=${noteBefore}`);

    const directive = "开头不够抓人，请把钩子改得更狠一点";
    const msg = await req("POST", `/api/tasks/${id}/message`, { text: directive });
    assert(
      "message → 200 {revision:true} (done task claimed for revision)",
      msg.status === 200 && msg.json?.ok === true && msg.json?.revision === true,
      `HTTP ${msg.status}: ${msg.text.slice(0, 160)}`,
    );
    assert("message echoed as user role", msg.json?.message?.role === "user" && msg.json?.message?.text === directive, JSON.stringify(msg.json?.message)?.slice(0, 120));

    const detail = await pollUntilTerminal(id);
    assert("revision run reaches done", detail?.status === "done", `status=${detail?.status ?? "no response"} stage=${detail?.stage ?? "-"}`);
    const events = Array.isArray(detail?.events) ? detail.events : [];
    assert(
      "stage_start reedit (回炉) ran",
      events.some((e) => e.type === "stage_start" && e.detail?.stage === "reedit"),
      `stage_start seen: ${events.filter((e) => e.type === "stage_start").map((e) => e.detail?.stage).join(", ")}`,
    );
    const doneEvents = events.filter((e) => e.type === "pipeline_done").length;
    assert("two pipeline_done events (initial + revision)", doneEvents === 2, `got ${doneEvents}`);
    const scored = events.filter((e) => e.type === "review" && typeof e.detail?.score === "number").length;
    assert("revision pass re-scored by critic (>=2 review events)", scored >= 2, `got ${scored}`);
    const noteAfter = detail?.finals?.xhs?.tuningNotes?.[0] ?? "";
    assert("final replaced by reedit version (回炉 marker)", noteAfter.includes("回炉"), `tuningNotes[0]=${noteAfter}`);
    const summaries = (detail?.messages ?? []).filter((m) => m.role === "ai" && m.meta?.kind === "pipeline_summary").length;
    assert("two AI delivery summaries", summaries === 2, `got ${summaries}`);
    assert(
      "directive stored in task messages",
      (detail?.messages ?? []).some((m) => m.role === "user" && m.text === directive),
      "user directive missing from messages",
    );
  } catch (err) {
    assert("revision case threw", false, err?.message ?? String(err));
  }
  return { label, rows, elapsedMs: Date.now() - t0 };
}

/**
 * File-attach flow (SPEC §5 /api/files, req 7): a text upload in mock mode is
 * extracted inline, brief.fileIds carries it into start, which merges the
 * extracted text into brief.materials before the pipeline runs.
 */
async function runFileAttachFlow() {
  const rows = [];
  const assert = checker(rows);
  const t0 = Date.now();
  const label = "[files] 上传文本素材 → 提取 → 并入简报 → 成功生成";
  const marker = "FIFI-MOCK-MATERIAL-2026";
  try {
    const content = `${marker} 冻干咖啡工艺说明：低温萃取，48小时冻干，保留香气与风味层次。`;
    const fd = new FormData();
    fd.append("file", new File([content], "素材.txt", { type: "text/plain" }));
    const up = await fetch(`${BASE}/api/files`, { method: "POST", headers: { cookie }, body: fd });
    const file = await up.json().catch(() => null);
    if (!assert("upload → 201 with id", up.status === 201 && nonEmptyStr(file?.id), `HTTP ${up.status}: ${JSON.stringify(file)?.slice(0, 160)}`)) {
      return { label, rows, elapsedMs: Date.now() - t0 };
    }
    assert("text file extracted inline", file.status === "extracted", `status=${file.status}`);
    assert("extractedChars > 0", typeof file.extractedChars === "number" && file.extractedChars > 0, `extractedChars=${file.extractedChars}`);

    const brief = {
      goal: "冻干速溶咖啡新品上市种草",
      audience: "25-35岁都市白领",
      platforms: ["xhs"],
      style: "专业种草",
      materials: "基础卖点：3秒速溶",
      fileIds: [file.id],
    };
    const created = await req("POST", "/api/tasks", { brief });
    if (!assert("create task with fileIds", created.status === 200 && nonEmptyStr(created.json?.id), `HTTP ${created.status}: ${created.text.slice(0, 160)}`)) {
      return { label, rows, elapsedMs: Date.now() - t0 };
    }
    const id = created.json.id;
    const started = await req("POST", `/api/tasks/${id}/start`);
    assert("start → 202", started.status === 202, `HTTP ${started.status}: ${started.text.slice(0, 160)}`);

    const detail = await pollUntilTerminal(id);
    assert("terminal status done", detail?.status === "done", `status=${detail?.status ?? "no response"}`);
    const materials = detail?.brief?.materials ?? "";
    assert("materials kept the manual brief text", materials.includes("3秒速溶"), `materials=${materials.slice(0, 120)}`);
    assert("materials merged the upload (上传素材 · name)", materials.includes("上传素材") && materials.includes("素材.txt"), `materials=${materials.slice(0, 120)}`);
    assert("materials contain the extracted file text", materials.includes(marker), `materials=${materials.slice(0, 160)}`);
    if (detail) checkFinal(assert, "xhs", detail.finals?.xhs);
  } catch (err) {
    assert("file-attach case threw", false, err?.message ?? String(err));
  }
  return { label, rows, elapsedMs: Date.now() - t0 };
}

/** Auth boundaries (SPEC §5): foreign tasks 404, missing session 401, list isolation. */
async function runAuthBoundaries() {
  const rows = [];
  const assert = checker(rows);
  const t0 = Date.now();
  const label = "[auth] 越权访问 404 · 未登录 401 · 列表隔离";
  try {
    const created = await req("POST", "/api/tasks", {
      brief: { goal: "边界测试任务", audience: "无", platforms: ["xhs"], style: "专业解读", materials: "无" },
    });
    if (!assert("create probe task", created.status === 200 && nonEmptyStr(created.json?.id), `HTTP ${created.status}`)) {
      return { label, rows, elapsedMs: Date.now() - t0 };
    }
    const id = created.json.id;

    // Other user: every owner-scoped route must answer 404 (not 403 — no existence leak).
    const intruder = await registerIsolated(`intruder-${Date.now()}`, "Intruder-Pass-2026!");
    if (assert("intruder registered", intruder.status === 201 && intruder.jar !== "", `HTTP ${intruder.status}`)) {
      const get = await req("GET", `/api/tasks/${id}`, undefined, intruder.jar);
      assert("foreign GET task → 404", get.status === 404, `HTTP ${get.status}`);
      const cancel = await req("POST", `/api/tasks/${id}/cancel`, undefined, intruder.jar);
      assert("foreign POST cancel → 404", cancel.status === 404, `HTTP ${cancel.status}`);
      const message = await req("POST", `/api/tasks/${id}/message`, { text: "越权指令" }, intruder.jar);
      assert("foreign POST message → 404", message.status === 404, `HTTP ${message.status}`);
      const del = await req("DELETE", `/api/tasks/${id}`, undefined, intruder.jar);
      assert("foreign DELETE task → 404", del.status === 404, `HTTP ${del.status}`);
      const list = await req("GET", "/api/tasks", undefined, intruder.jar);
      assert(
        "intruder task list is empty (isolation)",
        list.status === 200 && Array.isArray(list.json) && list.json.length === 0,
        `HTTP ${list.status}, count=${Array.isArray(list.json) ? list.json.length : "n/a"}`,
      );
    }

    // No session at all: 401 everywhere user-scoped.
    for (const [name, method, p, body] of [
      ["GET /api/tasks", "GET", "/api/tasks", undefined],
      ["GET /api/tasks/:id", "GET", `/api/tasks/${id}`, undefined],
      ["POST /api/tasks", "POST", "/api/tasks", { brief: { goal: "x", platforms: ["xhs"] } }],
      ["POST /api/tasks/:id/start", "POST", `/api/tasks/${id}/start`, undefined],
      ["GET /api/usage", "GET", "/api/usage?scope=daily&days=1", undefined],
    ]) {
      const res = await req(method, p, body, "");
      assert(`unauthenticated ${name} → 401`, res.status === 401, `HTTP ${res.status}`);
    }

    // Probe task is untouched by all of the above.
    const after = await req("GET", `/api/tasks/${id}`);
    assert("probe task still briefing for its owner", after.status === 200 && after.json?.status === "briefing", `HTTP ${after.status}, status=${after.json?.status}`);
  } catch (err) {
    assert("auth boundary case threw", false, err?.message ?? String(err));
  }
  return { label, rows, elapsedMs: Date.now() - t0 };
}

/** Brief validation (SPEC §5 start): incomplete briefs are rejected, task untouched. */
async function runBriefValidation() {
  const rows = [];
  const assert = checker(rows);
  const t0 = Date.now();
  const label = "[brief] 简报校验：空平台 400 · 空目标 400 · 非法平台 400";
  try {
    const created = await req("POST", "/api/tasks", {
      brief: { goal: "只有目标没有平台", audience: "测试", platforms: [], style: "", materials: "" },
    });
    if (!assert("create platform-less task (briefing ok)", created.status === 200 && created.json?.status === "briefing", `HTTP ${created.status}`)) {
      return { label, rows, elapsedMs: Date.now() - t0 };
    }
    const id = created.json.id;
    const started = await req("POST", `/api/tasks/${id}/start`);
    assert(
      "start with empty platforms → 400 mentioning 平台",
      started.status === 400 && typeof started.json?.error === "string" && started.json.error.includes("平台"),
      `HTTP ${started.status}: ${started.text.slice(0, 160)}`,
    );
    const after = await req("GET", `/api/tasks/${id}`);
    assert("task stays briefing (no pipeline fired)", after.json?.status === "briefing" && (after.json?.events ?? []).length === 0, `status=${after.json?.status}, events=${after.json?.events?.length}`);

    const emptyGoal = await req("POST", "/api/tasks", { brief: { goal: "", platforms: ["xhs"] } });
    assert("create with empty goal → 400", emptyGoal.status === 400, `HTTP ${emptyGoal.status}`);
    const badPlatform = await req("POST", "/api/tasks", { brief: { goal: "目标", platforms: ["weibo"] } });
    assert("create with unknown platform id → 400", badPlatform.status === 400, `HTTP ${badPlatform.status}`);
  } catch (err) {
    assert("brief validation case threw", false, err?.message ?? String(err));
  }
  return { label, rows, elapsedMs: Date.now() - t0 };
}

/** Weekly usage bucketing sanity (SPEC §5 /api/usage scope=weekly). */
async function runWeeklyUsage() {
  const rows = [];
  const assert = checker(rows);
  const t0 = Date.now();
  const label = "[usage] weekly ISO 周桶聚合 sanity";
  try {
    const res = await req("GET", "/api/usage?scope=weekly&days=7");
    if (!assert("GET scope=weekly → 200", res.status === 200 && res.json?.scope === "weekly", `HTTP ${res.status}: ${res.text.slice(0, 160)}`)) {
      return { label, rows, elapsedMs: Date.now() - t0 };
    }
    const { totals, buckets } = res.json;
    assert("1-2 buckets for a 7-day window", Array.isArray(buckets) && buckets.length >= 1 && buckets.length <= 2, `got ${buckets?.length}`);
    const keys = (buckets ?? []).map((b) => b.key);
    assert("all bucket keys are ISO weeks (YYYY-Www)", keys.length > 0 && keys.every((k) => /^\d{4}-W\d{2}$/.test(k)), `keys: ${keys.join(", ")}`);
    assert("bucket keys unique", new Set(keys).size === keys.length, `keys: ${keys.join(", ")}`);
    const sumCalls = (buckets ?? []).reduce((n, b) => n + b.calls, 0);
    assert("buckets sum to totals.calls", sumCalls === totals?.calls, `sum=${sumCalls}, totals=${totals?.calls}`);
    assert(
      `totals.calls >= ${USE_CASES.length * 6} (suite calls land in the window)`,
      totals?.calls >= USE_CASES.length * 6,
      `calls=${totals?.calls}`,
    );
    assert("current week bucket has calls", (buckets ?? []).at(-1)?.calls > 0, `last bucket: ${JSON.stringify(buckets?.at(-1))}`);

    const bad = await req("GET", "/api/usage?scope=monthly");
    assert("unknown scope → 400", bad.status === 400, `HTTP ${bad.status}`);
  } catch (err) {
    assert("weekly usage case threw", false, err?.message ?? String(err));
  }
  return { label, rows, elapsedMs: Date.now() - t0 };
}

// ===== Reporting =====

function printResults(results) {
  let pass = 0;
  console.log("\n──────────────────────────────── use-case results ────────────────────────────────");
  results.forEach((r, i) => {
    const failed = r.rows.filter((x) => !x.ok);
    const ok = failed.length === 0 && r.rows.length > 0;
    if (ok) pass++;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${String(i + 1).padStart(2)}  ${r.label}  (${r.rows.length} checks, ${(r.elapsedMs / 1000).toFixed(1)}s)`,
    );
    for (const f of failed) {
      console.log(`         ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
    }
  });
  console.log("───────────────────────────────────────────────────────────────────────────────────");
  console.log(`USECASES ${pass}/${results.length} PASSED`);
  return pass === results.length;
}

// ===== Main =====

async function main() {
  const t0 = Date.now();
  await startServer();
  await login();
  console.log(`logged in as ${USERNAME}; running ${USE_CASES.length} cases (concurrency ${CONCURRENCY})…`);

  const caseResults = await pool(USE_CASES, CONCURRENCY, runCase);
  const cross = await runCrossChecks(); // before the extra tasks: list must be exactly 21
  const multi = await runMultiPlatform();

  // Behavior scenarios run sequentially AFTER the cross checks (they create
  // extra tasks/users that would skew the exact-count asserts above).
  const scenarios = [];
  for (const scenario of [
    runCancelMidRun,
    runRevisionFlow,
    runFileAttachFlow,
    runAuthBoundaries,
    runBriefValidation,
    runWeeklyUsage,
  ]) {
    scenarios.push(await scenario());
  }

  const ok = printResults([...caseResults, cross, multi, ...scenarios]);
  console.log(`total wall time ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exitCode = ok ? 0 : 1;
}

main()
  .catch((err) => {
    console.error(`fatal: ${err?.stack ?? err}`);
    process.exitCode = 1;
  })
  .finally(cleanup);
