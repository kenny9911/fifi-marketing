-- FiFi 灰灰营销 — SQLite schema (idempotent; executed on boot by src/server/db.ts)
-- All ids are TEXT uuid v4 unless noted. Timestamps are ISO-8601 UTC strings.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,            -- scrypt: salt:hash hex
  recovery_code_hash TEXT,                -- scrypt of the one-time recovery code (on-screen reset)
  role TEXT NOT NULL DEFAULT 'user',      -- 'user' | 'admin'
  avatar_key TEXT,                        -- MinIO object key
  settings_json TEXT NOT NULL DEFAULT '{}', -- { defaultPlatforms, locale, hintsEnabled, ... }
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,                    -- short label derived from goal
  brief_json TEXT NOT NULL,               -- Brief: { goal, audience, platforms[], style, materials, notes }
  status TEXT NOT NULL DEFAULT 'briefing',-- 'briefing'|'running'|'reviewing'|'done'|'failed'|'cancelled'
  stage TEXT,                             -- current PipelineStage when running
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  role TEXT NOT NULL,                     -- 'user' | 'ai' | 'system'
  text TEXT NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}',   -- { chipSet?, ... } for restoring studio UI
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_task ON messages(task_id, created_at);

-- Append-only stream of pipeline progress; powers the SSE thinking timeline.
CREATE TABLE IF NOT EXISTS task_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  ts TEXT NOT NULL,
  type TEXT NOT NULL,        -- 'stage_start'|'thinking'|'tool_call'|'artifact'|'stage_done'|'review'|'error'|'pipeline_done'
  agent_id TEXT,             -- agents.id
  title TEXT NOT NULL,       -- short line shown in the timeline
  detail_json TEXT NOT NULL DEFAULT '{}'  -- { text?, platform?, score?, artifactId?, toolName?, ... }
);
CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id, seq);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  platform TEXT,                          -- PlatformId or NULL for cross-platform artifacts
  type TEXT NOT NULL,                     -- 'research'|'outline'|'draft'|'critique'|'final'|'prompt_pack'|'image'
  version INTEGER NOT NULL DEFAULT 1,
  content_json TEXT NOT NULL,             -- shape depends on type; finals use PlatformResult-compatible shape
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artifacts_task ON artifacts(task_id, type, platform, version);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  task_id TEXT REFERENCES tasks(id),
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  minio_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploaded', -- 'uploaded'|'extracting'|'extracted'|'failed'
  extracted_text TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id, created_at DESC);

-- ===== Reusable, fine-tunable agent system =====

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,                    -- 'searcher','organizer','critic','reviewer','reeditor','finalizer',
                                          -- 'crafter:xhs'...'crafter:csdn','promptsmith:text','promptsmith:image',
                                          -- 'promptsmith:video','extractor','image_director','reflector','brief_assistant'
  name TEXT NOT NULL,                     -- display name e.g. '搜罗' / '桃桃'
  role_title TEXT NOT NULL,               -- e.g. '情报搜集官'
  description TEXT NOT NULL,
  model_id TEXT NOT NULL,                 -- models.id; admin-configurable per agent
  fallback_model_id TEXT,
  tools_json TEXT NOT NULL DEFAULT '[]',  -- e.g. ["web_search","scrape"]
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  version INTEGER NOT NULL,
  template TEXT NOT NULL,                 -- system prompt template; {{var}} placeholders
  notes TEXT NOT NULL DEFAULT '',         -- why this version exists (evolution rationale)
  status TEXT NOT NULL DEFAULT 'active',  -- 'active'|'proposed'|'retired'  (one active per agent)
  score_avg REAL,                         -- rolling critic score for outputs produced under this version
  score_n INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(agent_id, version)
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,                    -- 'xhs:title-rules', 'dy:hook-patterns', ...
  platform TEXT,                          -- PlatformId or NULL for general skills
  name TEXT NOT NULL,
  content TEXT NOT NULL,                  -- markdown knowledge injected into crafter prompts
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,                    -- canonical OpenRouter-style id e.g. 'google/gemini-3-flash-preview'
  provider TEXT NOT NULL,                 -- preferred direct provider: 'openai'|'moonshot'|'minimax'|'openrouter'
  kind TEXT NOT NULL DEFAULT 'text',      -- 'text'|'multimodal'|'image'
  input_cost_per_m REAL NOT NULL DEFAULT 0,   -- USD per 1M input tokens
  output_cost_per_m REAL NOT NULL DEFAULT 0,  -- USD per 1M output tokens
  context_len INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_validated_at TEXT,                 -- last time the id was confirmed against a live provider list
  valid INTEGER                           -- NULL=unknown, 1=confirmed, 0=rejected by provider
);

CREATE TABLE IF NOT EXISTS llm_calls (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  user_id TEXT,
  task_id TEXT,
  agent_id TEXT,
  prompt_version INTEGER,
  model_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  purpose TEXT NOT NULL,                  -- 'pipeline:craft:xhs', 'extract', 'image', 'evolve', ...
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,                   -- 'ok'|'error'|'fallback'
  error TEXT,
  request_chars INTEGER NOT NULL DEFAULT 0,
  response_chars INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_calls_user_ts ON llm_calls(user_id, ts);
CREATE INDEX IF NOT EXISTS idx_calls_task ON llm_calls(task_id);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  platform TEXT NOT NULL,
  draft_version INTEGER NOT NULL,
  score REAL NOT NULL,                    -- 0-100 critic score
  rubric_json TEXT NOT NULL,              -- per-dimension scores + comments
  verdict TEXT NOT NULL,                  -- 'pass'|'revise'
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evolution_runs (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  trigger TEXT NOT NULL,                  -- 'manual'|'auto'
  window_days INTEGER NOT NULL DEFAULT 7,
  report_md TEXT NOT NULL,                -- improvement-plan markdown
  proposals_json TEXT NOT NULL,           -- [{agentId, fromVersion, toVersion, rationale}]
  status TEXT NOT NULL DEFAULT 'completed'
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
