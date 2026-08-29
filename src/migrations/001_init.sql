CREATE TABLE run (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project     TEXT NOT NULL,
  feature_id  TEXT NOT NULL,
  slug        TEXT NOT NULL,
  change_kind TEXT NOT NULL CHECK (change_kind IN ('feature', 'defect_fix')),
  status      TEXT NOT NULL DEFAULT 'in_progress'
              CHECK (status IN ('in_progress', 'blocked', 'completed')),
  profile_ref TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE stage (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id         INTEGER NOT NULL REFERENCES run(id),
  kind           TEXT NOT NULL,
  ordinal        INTEGER NOT NULL,
  input_stage_id INTEGER REFERENCES stage(id),
  output_ref     TEXT,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'in_progress', 'passed', 'blocked', 'failed')),
  gate_result    TEXT CHECK (gate_result IN ('pass', 'block')),
  started_at     TEXT,
  ended_at       TEXT,
  UNIQUE (run_id, ordinal)
);

CREATE TABLE audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     INTEGER NOT NULL REFERENCES run(id),
  stage_id   INTEGER REFERENCES stage(id),
  actor      TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  action     TEXT NOT NULL,
  summary    TEXT NOT NULL,
  hash       TEXT NOT NULL,
  prev_hash  TEXT,
  created_at TEXT NOT NULL
);

CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit
BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit
BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;

PRAGMA user_version = 1;
