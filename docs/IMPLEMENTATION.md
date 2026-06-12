# FiFi 灰灰营销 — Implementation Notes

How the system described in [SPEC.md](./SPEC.md) is actually built. Read [PLAN.md](./PLAN.md) for the requirement → component map.

## Runtime shape

Everything runs inside one Next.js 16 process. Route handlers under `src/app/api/**` are the backend; `src/server/**` is the service layer; SQLite (`data/fifi.db`, WAL) is both the store and the event bus. There is no queue or worker: `POST /api/tasks/:id/start` fires `startPipeline(taskId)` (fire-and-forget promise), the orchestrator persists every step into `task_events`, and any number of SSE readers (`GET /api/tasks/:id/stream`) replay + tail that table. A crashed/cancelled pipeline never strands the client: the stream closes on any terminal status.

```
Browser ── SSE ──▶ /api/tasks/:id/stream ──▶ task_events ◀── orchestrator
   │                                            ▲                │
   └── REST (tasks/files/usage/admin/auth) ──▶ src/server/** ──▶ llm/client ──▶ providers
```

## The pipeline (`src/server/pipeline/`)

`orchestrator.ts` runs the stage machine from SPEC §2. Per stage:
1. load the agent row + its **active prompt version** from the DB (never hardcoded),
2. `chatComplete({ agentId, ... })` with stage inputs as structured user messages (brief, research digest, platform skills, prior drafts, critic directives),
3. parse the JSON output; every agent returns a `thinking` field which becomes a `thinking` event (this is what the studio timeline renders),
4. write `artifacts` (versioned) / `reviews`, emit `stage_start` / `stage_done` events with durations.

Robustness invariants (enforced in `stages/common.ts` + orchestrator):
- every await is wrapped in a deadline (`app_settings.stage_timeout_ms`); timeout → one retry on the agent's fallback model → degrade and continue with an `error` event;
- one platform failing never kills the task — craft/critic/reedit run per platform inside isolated try/catch;
- revision loop is bounded (2 cycles) and force-finalizes into `reviewing` status with residual issues noted;
- cancellation is checked between stages;
- `runRevision(taskId, directive)` reuses reedit → critic → review → finalize for post-delivery chat edits.

## LLM access (`src/server/llm/`)

One function — `chatComplete` — is the only door to any model. It resolves the model (explicit override > agent registry), **validates the id** against the registry plus a 1h-cached live `GET /models` from the provider (unknown ids are marked invalid and never sent), walks the fallback chain (`agent.fallback_model_id` → `LLM_MODEL_DEFAULT` → cheapest valid), and **always** writes an `llm_calls` row — success, fallback, or error — with tokens, computed USD cost (registry per-million pricing), latency, purpose, and prompt version. Providers all speak the OpenAI dialect: OpenRouter is the default gateway; OpenAI/Moonshot/MiniMax go direct when their keys exist in `.env`.

`TEST_MODE=mock` short-circuits `chatComplete` (and MinIO) with deterministic Chinese fixtures keyed by purpose — the whole product runs offline at zero cost, which is what the test suites and CI use.

## Files & images

Uploads stream to MinIO (`fifi` bucket, endpoint parsed from `.env` including scheme quirks). Extractable mimes are handed to the `extractor` agent (gemini-3-flash multimodal via OpenRouter) and the text lands on `files.extracted_text`; `start` merges attached files' text into the brief materials. Image generation: the `image_director` agent picks a validated image model (OpenAI `gpt-image-1` direct or Gemini image via OpenRouter), the PNG is stored in MinIO, costs are logged flat per image (`app_settings.image_cost_*`).

## Self-evolution (`src/server/evolve.ts`)

`runEvolution` aggregates the window's `llm_calls` (error/fallback rates, latency), `reviews` (score distributions per platform), prompt rolling scores, and the worst-scoring drafts, then asks the `reflector` agent for an improvement plan (markdown) plus concrete prompt rewrites. Proposals land as `prompts` rows with `status='proposed'` — visible in the admin prompt drawer, activatable with one click; `auto_activate_proposals` exists but defaults off. Triggers: the admin Evolution panel, or automatically every N completed tasks (`auto_evolve_after_tasks`, checked during finalize, fire-and-forget). With fewer than 3 completed tasks in the window it returns a stub report without spending tokens.

## Auth

scrypt password hashes (`node:crypto`), HS256 JWT (jose) in an httpOnly `fifi_session` cookie, `src/proxy.ts` gates the app pages. Password reset is fully on-screen: a one-time recovery code (`FIFI-XXXX-XXXX-XXXX`) is shown at registration, only its hash is stored, and every successful reset rotates it. Login has an in-memory rate limiter + constant-time floor. The seeded admin is `admin` / `$ADMIN_PASSWORD` (default `FiFi_Admin_2026!` — change it in production; production seeding warns).

## Frontend

- `src/lib/client-api.ts` + `src/components/hooks/*` own all data access: `useWorkbench` is the studio state machine, `useTaskStream` the SSE consumer (seq-dedupe, `?since=` reconnect, cleanup on switch/unmount).
- `src/components/workbench/*` is the studio: sessions sidebar → brief intake (chip flow + uploads) → flight deck (`StageTracker` / `ThinkingTimeline` / `ResultsDeck` / `CostChip`).
- Result cards (`src/components/studio/results/*`) render the four `FinalResult` kinds; prompt packs come with copy buttons and rationale.
- `/usage`, `/admin`, `/settings`, `/login`, `/guide` per SPEC §6; guide content is build-time data in `src/lib/guide-content.ts` produced by the research workflow (sources in [RESEARCH-NOTES.md](./RESEARCH-NOTES.md)).

## Testing

- `npm run test:usecases` — boots a mock-mode server, runs **21 platform use cases** (3 per platform) end-to-end through the public API, asserting terminal status, final shapes per platform, prompt packs, event/thinking coverage, review scores, and the cost ledger; plus multi-platform isolation and edge-case tests (cancel, revision, files, auth boundaries, validation).
- `npm run test:e2e` — committed Playwright browser journey (register → recovery code → brief → live timeline → results → revision → restore → usage → settings → reset → admin → 403).

## Extending

- **New platform**: add to `src/lib/types.ts`/`platforms.ts`, seed a `crafter:<id>` agent + skills, add a result card (or rely on `GenericCard`).
- **New model**: insert via admin Models tab (or seeds) with pricing; validation will gate it automatically.
- **New agent/stage**: agents are data; stages are small modules in `pipeline/stages/` wired in the orchestrator.
- **Postgres/queue**: the service layer isolates better-sqlite3 behind `db.ts` and the bus is just `task_events` — swapping to Postgres + LISTEN/NOTIFY is mechanical.

## Known limits / future work

- Video is prompt-generation only (镜语 produces shot lists + generator-ready prompts); no video API is wired.
- Email-based reset could ride the existing `RESEND_API_KEY`; recovery codes were chosen to keep the flow fully on-screen per requirements.
- The login rate limiter and OpenRouter model-list cache are in-process (fine for single-instance; move to a shared store if scaled out).
- `next build` needs network for Google Fonts unless `.next/cache` is warm.
