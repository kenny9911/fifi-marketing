# 灰灰营销 FiFi — AI-Native Content Studio

一句话，承包你的全网内容。One brief → platform-tuned content for 微博 · 公众号 · 小红书 · 抖音 · 知乎 · 百家号 · CSDN, produced by a multi-agent AI content department (search → prompt-craft → craft → organize → critic → review → re-edit → finalize) with live thinking output, full cost accounting, and self-evolving prompts.

## Quick start

```bash
npm install
cp .env.example .env   # or create .env per the table below
npm run dev            # http://localhost:3000
```

Sign in at `/login` (register a user, or use the seeded admin `admin` / `FiFi_Admin_2026!` — override with `ADMIN_PASSWORD`; change it in production). Create content at `/studio`.

Run everything offline/free with deterministic mock LLMs:

```bash
TEST_MODE=mock npm run dev
```

## Environment (`.env`)

| Variable | Required | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | ✅ | Default gateway for all models without a direct key (Anthropic/Google/DeepSeek…) |
| `OPENAI_API_KEY` / `MOONSHOT_API_KEY` / `MINIMAX_API_KEY` | – | Direct-provider routing for `openai/*`, `moonshotai/*`, `minimax/*` |
| `LLM_MODEL_DEFAULT` | – | Fallback model id (default `google/gemini-3-flash-preview`) |
| `TAVILY_API_KEY` / `FIRECRAWL_API_KEY` | – | Research stage web search / scraping (degrades gracefully if absent) |
| `MINIO_ENDPOINT` / `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` / `MINIO_SECURE` | ✅ for files/images | Object storage for uploads, avatars, generated images |
| `AUTH_SECRET` | production | JWT signing secret |
| `ADMIN_PASSWORD` | – | Seeded admin password |
| `TEST_MODE=mock` | – | Deterministic offline mode (tests/CI) |

Model ids and per-million pricing are seeded from the registry (editable at `/admin` → 模型); invalid ids are validated against live provider lists and never sent.

## Pages

| Route | What |
|---|---|
| `/` | Landing (pop-collage design) |
| `/studio` | Workbench: sessions history, conversational brief + file uploads, live flight deck (stage tracker, agent thinking timeline, finals, prompt packs, image generation, cost chip) |
| `/usage` | Cost & tokens per task / daily / weekly, by agent & model |
| `/admin` | Per-agent model assignment, prompt versions, model registry + validation, skills, self-evolution reports |
| `/settings` | Profile, avatar, preferences, password |
| `/guide` | Researched per-platform content playbook (57 sources) |
| `/login` | Login / register / on-screen recovery-code password reset |

## Tests

```bash
npm run test:usecases   # 21 platform use cases + edge cases, end-to-end through the API (mock mode)
npm run test:e2e        # Playwright browser journey (mock mode)
```

## Docs

- [docs/PLAN.md](docs/PLAN.md) — requirements map & decisions
- [docs/SPEC.md](docs/SPEC.md) — binding architecture contract
- [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) — how it's built, how to extend
- [docs/RESEARCH-NOTES.md](docs/RESEARCH-NOTES.md) — platform know-how research + sources
