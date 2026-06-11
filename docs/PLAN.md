# FiFi 灰灰营销 — Build Plan

Goal: evolve the design-handoff frontend into a complete AI-native content platform — a multi-agent pipeline that researches, crafts, critiques, revises, and finalizes platform-tuned Chinese social content, with full cost accounting, persistence, file understanding, self-evolution, and admin control.

## Requirements → where they land

| # | Requirement | Where |
|---|---|---|
| 1 | search→craft→organize→critic→review→re-edit→finalize pipeline | `src/server/pipeline/` orchestrator + stages (SPEC §2) |
| 2 | Reusable, fine-tunable agents/skills/prompts/tools | DB registry: `agents`/`prompts` (versioned)/`skills` tables, admin-editable, evolution-refinable |
| 3 | Text/image/video prompt generators, researched & refined at runtime | `promptsmith:text/image/video` agents in the prompt_craft stage; research digest in, professional prompt packs out |
| 4 | Thinking output on screen | Every agent emits a `thinking` field → `task_events` → SSE → studio flight-deck timeline |
| 5 | Cost/token per task, daily, weekly, per user | `llm_calls` ledger + `usage.ts` aggregation + `/usage` page + live task cost chip |
| 6 | Chat history, load & continue sessions | `tasks`/`messages`/`task_events`/`artifacts` persistence + sessions sidebar + full TaskDetail restore |
| 7 | File uploads + multimodal extraction | MinIO + `extractor` agent (gemini-3-flash multimodal) in `pipeline/extract.ts` |
| 8 | Image generation with model picking | `image_director` agent routes between OpenAI gpt-image-1 and Gemini image (via OpenRouter), validated at runtime |
| 9 | Easy UX, guided next steps, hints/tooltips | Coach marks, status-pill guidance, tooltips, empty states that name the next action |
| 10 | Full logging + improvement plan + self-evolution | `llm_calls`+`reviews`+`task_events` → `reflector` agent → `evolution_runs` + proposed prompt versions; manual + auto trigger |
| 11 | Full backend/API services | 20+ route handlers (SPEC §5) |
| 12 | 3 use cases × 7 platforms, tested & fixed | `tests/usecases.ts` against TEST_MODE=mock pipeline + Playwright e2e |
| 13 | Plan/spec/implementation markdown | `docs/PLAN.md` (this), `docs/SPEC.md`, `docs/IMPLEMENTATION.md` |
| 14 | Styled user guide with researched know-how | Deep-research workflow → `src/lib/guide-content.ts` → `/guide` page |
| 15 | Keys in .env, latest models per provider, OpenRouter fallback | `llm/router.ts` provider preference + registry seeded from .env price table |
| 16 | Never send invalid model ids | `validateModelId` against live provider lists, cached; fallback chain |
| 17 | Log all LLM call details | `llm_calls`: tokens, cost, latency, provider, purpose, status, errors |
| 18 | Files in MinIO | `src/server/minio.ts` (endpoint parsed from .env) |
| 19 | Admin page: model per agent | `/admin` agents table + model dropdowns + prompt versions + validate |
| 20 | Login + on-screen forgot password | `/login` (3 tabs); recovery-code reset (shown once, rotated on use) |
| 21 | Settings & profile page | `/settings` |

## Team design (who does what)

**Content department (runtime agents, DB rows):** 灰灰 (brief), 搜罗 (search), 文枢/画引/镜语 (promptsmiths), 桃桃/阿飞/文叔/薇薇/谨言/百晓/码哥 (platform crafters), 理整 (organizer), 老辣 (critic), 总编 (reviewer), 回炉 (re-editor), 定稿 (finalizer), 拆件 (extractor), 选模 (image director), 复盘 (reflector). Personas, default models, and rationale in SPEC §1. Premium models only where judgment matters (reviewer, reflector); cheap fast models everywhere else; admin can re-assign any of it.

**Build crew (one-off implementation workflows):**
- *Workflow A — backend foundation*: 6 builders (db-auth / llm / registry-seeds / storage-files / pipeline / images-usage-evolve) → compile fixer → 3 adversarial reviewers (security, llm-cost, pipeline robustness) + fixers → mock-mode e2e smoke agent.
- *Workflow C — guide research*: 7 platform researchers + 1 strategist (live web search) → synthesizer → source auditor.
- *Workflow B — frontend*: builders for login/studio-flight-deck/usage/admin/settings/guide → compile → UX + fidelity review → fix.
- *Workflow D — testing*: 21 use-case suite + e2e, fix loop until green.

## Key decisions

- **SQLite (better-sqlite3, WAL)** over Postgres: zero-ops local-first; the ledger/aggregation needs are modest; swap path documented.
- **Single LLM dialect**: every provider (OpenRouter, OpenAI, Moonshot, MiniMax) speaks OpenAI chat-completions → one client, per-provider baseURL. Anthropic/Google models ride OpenRouter since no direct keys exist in .env.
- **In-process pipeline, DB as the bus**: stages write `task_events`; SSE replays+polls the table. No queue infra; restart-safe observation; deadlock guard = per-stage timeouts + fallback + degrade-and-continue.
- **Mock mode as a first-class citizen** (`TEST_MODE=mock`): deterministic fixtures behind the same `chatComplete`/MinIO interfaces → the entire 21-use-case suite runs free and offline.
- **Recovery-code reset** (no email dependency): code shown once at registration, scrypt-hashed, rotated on every use. RESEND key exists if email reset is wanted later.
- **Self-evolution is conservative by default**: reflector proposes new prompt versions (`status=proposed`); auto-activation is an opt-in app setting; every version carries rolling critic-score stats so regressions are visible.

## Milestones

1. ✅ Spine: SPEC, schema, shared API types
2. Workflow A backend green (compile + adversarial review + mock smoke) → commit
3. Workflow C research content landed → commit with B
4. Workflow B frontend green → commit
5. Workflow D: 21 use cases + e2e all passing, issues fixed → commit
6. IMPLEMENTATION.md + final verify → push
