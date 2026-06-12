# Tests

Two suites, both running the real Next.js app against a throwaway SQLite file
in **mock mode** — fast, free, deterministic, no API keys needed.

## What mock mode is

`TEST_MODE=mock` swaps every external dependency for a deterministic in-process
fake behind the same interfaces (SPEC §7):

- **LLM** — `chatComplete` returns canned JSON per agent/purpose from
  `src/server/llm/mock.ts` (still logs an `llm_calls` row, cost 0). Crafter
  fixtures echo the brief goal into the title/body, so tests can assert
  end-to-end propagation.
- **Search** — Tavily/Firecrawl return fixture results, no network.
- **MinIO** — an in-memory map; presigned URLs become browser-loadable
  `data:` URLs.
- **Images** — a 1×1 PNG, keeping the full generate→store→presign flow alive.
- **Latency hook** — a brief/message containing `MOCK_SLOW` stretches every
  mock LLM call to ~250ms (see `src/server/llm/client.ts`), so a test can
  observe a pipeline while it is still in flight (used by the cancel
  scenario). Normal fixtures stay instant.

Both suites also point `FIFI_DB_PATH` at a dedicated db file under `data/` so
your dev database is never touched, and `NEXT_DIST_DIR` at a dedicated dist dir
(`.next-test` / `.next-e2e`) so the Next 16 single-dev-server lock doesn't
collide with a `npm run dev` you already have running.

## Use-case suite (API level)

```sh
npm run test:usecases
```

`tests/usecases.mjs` (plain Node ESM, node >= 24, no test framework):

1. Boots its own dev server (`FIFI_DB_PATH=data/fifi-test.db TEST_MODE=mock
   PORT=3333`), logs in `data/test-server.log`, 90s boot budget. The server is
   always killed and `data/fifi-test.db*` removed on exit — including failures
   and Ctrl-C.
2. Registers user `usecase-runner`, then runs the **21 use cases** (3 per
   platform, concurrency 3). Each case: `POST /api/tasks` → `POST …/start` →
   poll `GET /api/tasks/:id` (1s, 120s budget) → assert:
   - terminal status `done`/`reviewing`,
   - `finals[platform]` with the right `kind` (`xhs`/`dy`/`mp` bespoke,
     `generic` otherwise) and non-empty title/content per `src/lib/results.ts`,
   - prompt packs: a platform-scoped `text` pack + an `image` pack (+ a
     `video` pack for 抖音),
   - events: `stage_start` for all 7 always-run stages, ≥5 `thinking` events,
     a `review` event with a numeric score (the critic writes it in the same
     stage call that inserts the `reviews` row),
   - `GET /api/usage?scope=task&id=…` shows `totals.calls > 0`.
3. Cross-case asserts: `GET /api/tasks` lists exactly 21 tasks;
   `GET /api/usage?scope=daily&days=1` shows ≥ 21×6 calls; then one extra
   multi-platform task (`xhs+dy+mp+wb`) asserting 4 finals and per-platform
   isolation (scoped text packs + per-platform critic reviews).
4. Runs **6 behavior scenarios** sequentially (SPEC §2/§5 contracts the
   happy-path cases don't touch):
   - **cancel mid-run** — `MOCK_SLOW` brief slows the pipeline; cancel while
     running → status `cancelled`, `pipeline_done {cancelled:true}`, no
     finalize/finals, and a live SSE stream closes with a `done` payload;
   - **revision flow** — message on a `done` task → `{revision:true}`,
     reedit (回炉) stage runs, two `pipeline_done` events, the final is
     replaced by the reedit version, second AI delivery summary;
   - **file attach** — multipart text upload → inline-extracted FileDto,
     `brief.fileIds` merged into `brief.materials` on start (`上传素材 ·
     name` + file text), pipeline completes;
   - **auth boundaries** — another user gets 404 on all owner-scoped task
     routes and an empty task list; no session → 401; the probe task is
     untouched;
   - **brief validation** — start with zero platforms → 400 and the task
     stays `briefing` with no events; empty goal / unknown platform id → 400
     at create;
   - **weekly usage** — `scope=weekly&days=7` buckets are unique ISO-week
     keys (`YYYY-Www`), sum to `totals.calls`, current week non-empty;
     unknown scope → 400.
5. Prints a per-case PASS/FAIL table (21 cases + cross + multi + 6 scenarios
   = 29 rows) and `USECASES n/m PASSED`; exit code 0 only on a full pass.

## UI smoke suite (browser level)

```sh
npm run test:e2e
```

which expands to

```sh
python3 /Users/kenny/.claude/skills/webapp-testing/scripts/with_server.py \
  --server "env FIFI_DB_PATH=data/fifi-e2e.db TEST_MODE=mock PORT=3221 NEXT_DIST_DIR=.next-e2e npm run dev" \
  --port 3221 -- python3 tests/e2e/ui-smoke.py
```

`tests/e2e/ui-smoke.py` (Playwright, headless Chromium, `BASE_URL` env
overridable, default `http://localhost:3221`) walks the whole journey with a
fresh random user: register → recovery-code modal (copy + confirm) → brief
chips (goal/受众/平台/风格/素材) → launch → live thinking timeline → results
card → copy → 生成配图 → revision via chat (回炉) → reload + session restore →
usage → settings → logout → password reset with the recovery code → login with
the new password → `/admin` 403 for non-admins. Exits non-zero on the first
failure and drops `data/ui-smoke-failure.png`.

Requires `playwright` for python3 with Chromium installed
(`pip install playwright && playwright install chromium`). Note the e2e db
`data/fifi-e2e.db` is not auto-deleted (the wrapper owns the server process);
remove it for a fully fresh run.

## Adding a use case

Add a row to `USE_CASES` in `tests/usecases.mjs`:

```js
{ p: "xhs", goal: "你的营销目标一句话", audience: "目标人群短语" },
```

- `p` is one of `xhs dy mp wb zh bjh csdn`; the expected final `kind`,
  style (专业种草/专业解读) and the per-platform pack/event assertions are all
  derived from it automatically.
- Keep the audience a short phrase pulled from the goal.
- Cross-case numbers adapt automatically (`USE_CASES.length`), but the
  "lists 21 tasks" wording in this README is then stale — the assert itself
  always uses the live count.
