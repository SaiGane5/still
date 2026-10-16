CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text UNIQUE,            -- subject from an external identity provider (null for guests)
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description      text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  planned_seconds  integer NOT NULL CHECK (planned_seconds BETWEEN 60 AND 28800),
  remaining_seconds integer NOT NULL CHECK (remaining_seconds >= 0),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  position         integer NOT NULL,
  timer_running    boolean NOT NULL DEFAULT false,
  timer_anchor_at  timestamptz NOT NULL DEFAULT now(), -- remaining_seconds is the value at this instant
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  CHECK (remaining_seconds <= planned_seconds),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);
CREATE INDEX tasks_user_queue_idx ON tasks (user_id, status, position);
CREATE INDEX tasks_user_completed_idx ON tasks (user_id, completed_at) WHERE status = 'completed';

CREATE TABLE notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,  -- one document per task
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    text NOT NULL DEFAULT '' CHECK (char_length(content) <= 200000),
  version    integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notes_user_idx ON notes (user_id);

CREATE TABLE focus_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  outcome         text NOT NULL CHECK (outcome IN ('completed', 'skipped', 'interrupted')),
  planned_seconds integer NOT NULL,
  focused_seconds integer NOT NULL CHECK (focused_seconds >= 0),
  ended_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX focus_sessions_user_idx ON focus_sessions (user_id, ended_at);
CREATE INDEX focus_sessions_task_idx ON focus_sessions (task_id);
