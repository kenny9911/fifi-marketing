# FiFi 灰灰营销 — Agentic Platform Spec (v1)

This is the **binding contract** for all implementation work. Companion files:
- `src/server/schema.sql` — DB DDL (authoritative)
- `src/lib/api-types.ts` — API/domain shapes shared by frontend & backend (authoritative)

Stack: Next.js 16 App Router (route handlers as backend) · SQLite (better-sqlite3, WAL, file `data/fifi.db`) · MinIO (uploads + generated images) · OpenAI-SDK-compatible LLM providers · SSE for live progress. No external queue: the pipeline runs in-process, fire-and-forget from the start route, state persisted in SQLite so any request/SSE poller can observe it.

## 1. The agent team (七嘴八舌内容部)

| agents.id | 名字 | Role | Default model | Why |
|---|---|---|---|---|
| `brief_assistant` | 灰灰 | 简报管家 — chats with user, fills brief, suggests next step | `google/gemini-3-flash-preview` | fast, cheap |
| `searcher` | 搜罗 | 情报搜集官 — Tavily/Firecrawl research on topic+audience+platform trends | `google/gemini-3-flash-preview` | summarization |
| `promptsmith:text` | 文枢 | 文案提示词工程师 — builds the optimized writing prompt per platform from brief+research | `openai/gpt-5.4-mini` | structured reasoning |
| `promptsmith:image` | 画引 | 图像提示词工程师 — professional image-gen prompts (cover/配图) | `openai/gpt-5.4-mini` | |
| `promptsmith:video` | 镜语 | 视频提示词工程师 — shot-list & video-gen prompts (抖音/视频号) | `openai/gpt-5.4-mini` | |
| `crafter:xhs` … `crafter:csdn` | 桃桃/阿飞/文叔/薇薇/谨言/百晓/码哥 | 平台专家撰稿 (7) — reuse studio personas | `moonshotai/kimi-k2.6` | strong Chinese copywriting |
| `organizer` | 理整 | 结构整理师 — normalizes drafts into platform result shapes, consistency pass | `google/gemini-3-flash-preview` | |
| `critic` | 老辣 | 毒舌评审 — scores 0–100 against rubric (hook, platform fit, audience, CTA, compliance) | `deepseek/deepseek-v4-pro` | cheap reasoning |
| `reviewer` | 总编 | 总编复核 — pass/revise decision + revision directives | `anthropic/claude-sonnet-4.6` | judgment |
| `reeditor` | 回炉 | 重写编辑 — applies directives to failing drafts | `moonshotai/kimi-k2.6` | |
| `finalizer` | 定稿 | 交付官 — final polish, publishes artifacts, summary message | `google/gemini-3-flash-preview` | |
| `extractor` | 拆件 | 多模态文件解析 — extracts text from uploads | `google/gemini-3-flash-preview` | multimodal, per req |
| `image_director` | 选模 | 图像模型路由 — picks image model + invokes generation | `openai/gpt-5.4-mini` | |
| `reflector` | 复盘 | 自进化分析师 — reads logs/scores, writes improvement plan + prompt proposals | `anthropic/claude-opus-4.8` | deep analysis |

All agents are **rows in `agents`** with versioned prompts in `prompts` (one `active` per agent) and reusable knowledge in `skills` — admin-editable, evolution-refinable. Stage code NEVER hardcodes prompts; it loads the active prompt template and interpolates `{{vars}}`.

## 2. Pipeline state machine

`runPipeline(taskId)` in `src/server/pipeline/orchestrator.ts`:

```
search → prompt_craft → craft(parallel per platform) → organize
  → critic(per platform) → review →
      revise? → reedit(failing platforms) → critic → review   (max 2 revision cycles)
  → finalize → done
```

- Every transition emits `task_events` rows (and stage updates on `tasks.stage`).
- Each agent call emits a `thinking` event with a 1–3 sentence reasoning summary (the model is asked to produce a `thinking` field in its JSON output — shown on screen, req 4).
- Tool calls (search/scrape/image) emit `tool_call` events.
- Drafts/critiques/finals stored in `artifacts` (versioned). Critic scores in `reviews`.
- Review threshold: pass ≥ 75 (app_settings `review_pass_score`, default 75). After 2 revision cycles, force-finalize with `review` event noting残留问题.
- Failure of one platform must NOT kill the task: mark that platform's final with `error` flavor and continue; only systemic failures (auth, DB) set tasks.status='failed'.
- Cancellation: `tasks.status='cancelled'` checked between stages.
- **Deadlock guard**: every stage call has a hard timeout (default 120s, `app_settings.stage_timeout_ms`); on timeout → retry once with fallback model → emit `error` event and continue with degraded output. The orchestrator NEVER awaits anything without a timeout.

## 3. LLM layer (`src/server/llm/`)

`client.ts` exports ONE function used by everything:

```ts
chatComplete(opts: {
  agentId?: string;            // resolves model + active prompt version from registry
  model?: string;              // explicit override (canonical id, e.g. 'openai/gpt-5.4')
  system?: string;
  messages: { role: "system"|"user"|"assistant"; content: string | MultiModalPart[] }[];
  json?: boolean;              // request JSON object output
  taskId?: string; userId?: string;
  purpose: string;             // e.g. 'pipeline:craft:xhs'
  temperature?: number; maxTokens?: number;
  timeoutMs?: number;          // default 120_000
}): Promise<{
  content: string; parsed?: unknown;
  usage: { promptTokens: number; completionTokens: number; costUsd: number };
  model: string; provider: string; latencyMs: number;
}>
```

Every call (success AND failure) inserts an `llm_calls` row (req 17). Cost = tokens × `models` pricing (seeded from .env comment block). If the provider returns usage, use it; else estimate chars/4.

`router.ts` — model resolution (req 15, 16):
1. Canonical ids are OpenRouter-style `vendor/model`.
2. Direct-provider preference when key exists: `openai/*` → OpenAI API (strip prefix) with `OPENAI_API_KEY`; `moonshotai/*` → Moonshot (`https://api.moonshot.ai/v1`); `minimax/*` → MiniMax (`https://api.minimax.io/v1`); otherwise → OpenRouter (`https://openrouter.ai/api/v1`) with full id.
3. **Validation routine** `validateModelId(id)`: checks (a) `models` table enabled, (b) live provider list — OpenRouter `GET /models` cached 1h in-process (and direct-provider `GET /models` where supported). Unknown id → marked `valid=0`, NEVER sent to a provider.
4. Fallback chain on invalid/erroring model: agent.fallback_model_id → `LLM_MODEL_DEFAULT` env → cheapest enabled+valid text model. Each fallback logged with status='fallback'.

All providers speak the OpenAI chat-completions dialect → single `openai` npm client with per-provider baseURL. Keys only from `process.env` — never sent to the browser.

## 4. Other server modules

- `src/server/db.ts` — exports `db` (better-sqlite3 singleton, WAL, runs `schema.sql` idempotently on first import, then `runSeeds()`), `nowIso()`, `uid()` (crypto.randomUUID).
- `src/server/seeds.ts` — idempotent: models (from the .env price table — 10 models, provider per §3.2, gemini marked `multimodal`), agents (§1), prompt v1 per agent (professional Chinese system prompts; crafters embed persona + platform skills), skills (2–4 per platform: 标题规则/结构模板/平台雷区/流量机制), admin user (`admin` / env `ADMIN_PASSWORD` or `FiFi_Admin_2026!`, role=admin), app_settings defaults. Image models seeded: `openai/gpt-image-1` (provider openai, kind image), `google/gemini-2.5-flash-image` (openrouter, image) — validated at runtime before use, never blind-sent.
- `src/server/auth.ts` — scrypt hash/verify (`node:crypto`), JWT (jose, HS256, secret = env `AUTH_SECRET` or derived stable dev secret) in httpOnly cookie `fifi_session` (7d). Exports `getSessionUser(): Promise<UserRow|null>`, `requireUser()`, `requireAdmin()` returning user or throwing `ApiError(401/403)`; route helper `handle(fn)` maps ApiError→JSON.
- `src/server/minio.ts` — client from env (`MINIO_ENDPOINT` may include scheme: parse host/port/useSSL; `MINIO_SECURE` respected only when no scheme), `ensureBucket('fifi')`, `putObject(key, buf, mime)`, `presignedGetUrl(key, 3600)`. All user files + generated images live in MinIO (req 18).
- `src/server/search.ts` — `webSearch(query, opts)` via Tavily REST; `scrape(url)` via Firecrawl REST; both logged as `tool_call` events when used inside the pipeline.
- `src/server/usage.ts` — aggregation for `UsageReport` (scope task/daily/weekly, per user; admin can query any/all users).
- `src/server/evolve.ts` — `runEvolution(trigger)`: aggregates llm_calls + reviews + prompt score_avg over window → reflector agent → `evolution_runs` row + `prompts` rows with status='proposed' (auto-activate only if `app_settings.auto_activate_proposals=true`). Auto-trigger: after every N completed tasks (default 10) — checked in finalize stage.
- `src/server/pipeline/extract.ts` — multimodal extraction: images/PDFs sent as data-URL parts to a `kind='multimodal'` model (default extractor agent → gemini-3-flash) via OpenRouter; plain text/markdown read directly; result → `files.extracted_text`.
- `src/server/images.ts` — `generateImage({taskId, userId, platform, brief, stylePrompt})`: image_director picks model (validated, from `models` kind='image' + key availability), calls OpenAI Images API or OpenRouter image-output chat; stores PNG in MinIO; `artifacts` row type='image'; cost logged with flat per-image price in app_settings (`image_cost_openai`=0.04, `image_cost_gemini`=0.03 default).

## 5. API routes (`src/app/api/`)

All JSON; auth via session cookie; errors `{ error: string }` with proper status.

| Route | Method | Auth | Notes |
|---|---|---|---|
| `/api/auth/register` | POST | – | {username, password, displayName} → `RegisterResponse` (recoveryCode shown once) |
| `/api/auth/login` | POST | – | {username, password} → {user} + cookie |
| `/api/auth/logout` | POST | user | clears cookie |
| `/api/auth/reset` | POST | – | {username, recoveryCode, newPassword} → ok + NEW recoveryCode (rotate) |
| `/api/auth/me` | GET | – | {user} or {user:null} |
| `/api/profile` | GET/PUT | user | PUT: {displayName?, settings?, password? {current,next}}; avatar upload via /api/files then PUT {avatarFileId} |
| `/api/tasks` | GET/POST | user | GET → TaskSummary[] (own); POST {brief} → TaskDetail (status briefing) |
| `/api/tasks/[id]` | GET/DELETE | owner | TaskDetail (full restore: messages+events+finals — req 6) |
| `/api/tasks/[id]/start` | POST | owner | validates brief, status→running, fires runPipeline (no await), 202 |
| `/api/tasks/[id]/message` | POST | owner | {text} → stored; if status done/reviewing: treated as revision directive → targeted reedit cycle |
| `/api/tasks/[id]/cancel` | POST | owner | status→cancelled |
| `/api/tasks/[id]/stream` | GET | owner | SSE; replays events after `?since=seq`, then polls task_events every 700ms until the task reaches a terminal status (set strictly after pipeline_done, so a pipeline_done replayed from an earlier run never closes a stream over an in-flight revision); payloads per `StreamPayload` |
| `/api/files` | POST | user | multipart form (file, taskId?) → FileDto; auto-extract when mime needs it (req 7) |
| `/api/files/[id]` | GET | owner | FileDto with presigned url |
| `/api/images/generate` | POST | owner | {taskId, platform, hint?} → ImageArtifactDto (req 8) |
| `/api/usage` | GET | user | `?scope=task&id=` / `?scope=daily|weekly&days=` → UsageReport (own); admin: `&userId=` or `&all=1` (req 5) |
| `/api/admin/agents` | GET/PUT | admin | PUT {id, modelId?, fallbackModelId?, enabled?} (req 19) |
| `/api/admin/agents/[id]/prompts` | GET/POST | admin | POST {template, notes, activate?} → new version |
| `/api/admin/prompts/[id]/activate` | POST | admin | swaps active version |
| `/api/admin/models` | GET/POST | admin | POST upsert model row |
| `/api/admin/models/validate` | POST | admin | runs validation over registry → per-model valid flags |
| `/api/admin/evolve` | POST/GET | admin | POST {windowDays?} → EvolutionRunDto; GET → history (req 10) |
| `/api/admin/skills` | GET/PUT | admin | edit skill content (versioned bump) |

Page protection: `src/proxy.ts` (Next 16 convention) redirects unauthenticated users from `/studio`, `/usage`, `/settings`, `/admin` (admin also role-checked server-side) to `/login?next=…`. Landing `/` and `/guide` stay public.

## 6. Frontend pages

- `/login` — login + register + on-screen forgot-password (3 tabs), pop-collage style, recovery-code reveal modal with copy button.
- `/studio` — reworked: left = sessions sidebar (history, load/continue, req 6) + brief panel; middle = chat (brief_assistant flow as today, plus file upload chips, req 7); right = **flight deck**: stage tracker (8 stages), live thinking timeline (SSE), per-platform result tabs with version history, prompt packs (text/image/video) with copy, 生成配图 button, task cost chip (live, req 5).
- `/usage` — per-task table + daily/weekly toggle + by-agent/by-model breakdowns; CSS bar charts; admin sees user filter.
- `/admin` — agents table (model dropdown per agent — req 19), prompt version drawer with diff + activate, models registry + validate button, skills editor, evolution panel (trigger + reports).
- `/settings` — profile (display name, avatar via MinIO), password change, recovery code rotate, preferences (default platforms, hints on/off).
- `/guide` — beautifully styled know-how page per platform (researched content), public.
- UX (req 9): first-visit coach marks on studio (dismissable, stored in settings), tooltips on every control (`title` + styled hover tips), empty states always say the next step, status pill row guides 简报→生成→复核→交付.

## 7. Testing (req 12)

- `TEST_MODE=mock` env: `chatComplete` returns deterministic canned JSON per agent/purpose from `src/server/llm/mock.ts` fixtures (zero cost, no network); search/image/minio get in-memory fakes behind the same interfaces.
- 21 use cases (3 per platform) in `tests/usecases.ts`: brief in → pipeline run → assertions on artifacts/finals/reviews/events/llm_calls rows.
- Runner: `npm run test:usecases` (tsx script, no framework dep) + Playwright e2e (`tests/e2e/`) for auth, studio flow, admin, usage.

## 8. Env contract

Required: `OPENROUTER_API_KEY`. Optional direct: `OPENAI_API_KEY`, `MOONSHOT_API_KEY`, `MINIMAX_API_KEY`. Tools: `TAVILY_API_KEY`, `FIRECRAWL_API_KEY` (absent → search stage degrades gracefully with an `error` event + empty research). Storage: `MINIO_ENDPOINT/ACCESS_KEY/SECRET_KEY/SECURE`. `LLM_MODEL_DEFAULT`, `AUTH_SECRET`, `ADMIN_PASSWORD`, `TEST_MODE`. DB path: `data/fifi.db` (gitignored).
