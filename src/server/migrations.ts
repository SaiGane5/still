/**
 * Schema migrations, embedded as strings so they ship inside serverless bundles.
 * 001 is the base schema (idempotent: safe on a database that already has it).
 * 002 adds server-side timer columns used by the focus timer.
 */
export const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "001_base_schema",
    sql: `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_provider_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  planned_duration_seconds INTEGER NOT NULL DEFAULT 1500 CHECK (planned_duration_seconds BETWEEN 1 AND 86400),
  remaining_seconds INTEGER CHECK (remaining_seconds IS NULL OR remaining_seconds BETWEEN 0 AND 86400),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'skipped')),
  queue_position INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tasks_user_queue ON tasks (user_id, status, queue_position);
CREATE INDEX IF NOT EXISTS idx_tasks_user_created ON tasks (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS task_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS focus_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  planned_duration_seconds INTEGER NOT NULL CHECK (planned_duration_seconds > 0),
  elapsed_seconds INTEGER NOT NULL DEFAULT 0 CHECK (elapsed_seconds >= 0),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'paused', 'completed', 'interrupted')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_focus_sessions_user_started ON focus_sessions (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_focus_sessions_task ON focus_sessions (task_id, started_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_updated_at ON tasks;
CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS task_notes_updated_at ON task_notes;
CREATE TRIGGER task_notes_updated_at BEFORE UPDATE ON task_notes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
`,
  },
  {
    name: "002_timer_state",
    sql: `
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS timer_running BOOLEAN NOT NULL DEFAULT false;
-- remaining_seconds is the value at this instant (when running, time keeps passing server-side)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS timer_anchor_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
`,
  },
  {
    name: "003_google_identity",
    sql: `
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_user_completed ON tasks (user_id, completed_at DESC) WHERE status = 'completed';
`,
  },
  {
    name: "004_assistant_chats",
    sql: `
CREATE TABLE IF NOT EXISTS assistant_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assistant_chats_user ON assistant_chats (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS assistant_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES assistant_chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL DEFAULT '',
  proposed_tasks JSONB,
  queued BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assistant_messages_chat ON assistant_messages (chat_id, created_at);

DROP TRIGGER IF EXISTS assistant_chats_updated_at ON assistant_chats;
CREATE TRIGGER assistant_chats_updated_at BEFORE UPDATE ON assistant_chats FOR EACH ROW EXECUTE FUNCTION set_updated_at();
`,
  },
];
