CREATE TABLE agent_run (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id         INTEGER NOT NULL REFERENCES stage(id),
  agent            TEXT NOT NULL,
  role             TEXT NOT NULL CHECK (role IN ('author', 'reviewer')),
  executor         TEXT NOT NULL,
  requested_model  TEXT NOT NULL,
  effective_model  TEXT,
  fallback         TEXT,
  tokens_in        INTEGER,
  tokens_out       INTEGER,
  cache_read       INTEGER,
  cache_write      INTEGER,
  cost             REAL,
  duration_ms      INTEGER NOT NULL,
  input_hash       TEXT NOT NULL,
  output_hash      TEXT NOT NULL,
  raw_output_ref   TEXT NOT NULL,
  independence     TEXT NOT NULL
                   CHECK (independence IN ('unverified_self_attestation', 'configured_standalone'))
);

PRAGMA user_version = 2;
