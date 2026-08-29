CREATE TABLE approval (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id          INTEGER NOT NULL REFERENCES run(id),
  feature_id      TEXT NOT NULL,
  spec_hash       TEXT NOT NULL,
  starting_commit TEXT NOT NULL,
  profile_hash    TEXT NOT NULL,
  risk            TEXT NOT NULL CHECK (risk IN ('low', 'standard', 'high')),
  scope           TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  signature       TEXT NOT NULL,
  signer          TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  UNIQUE (run_id)
);

PRAGMA user_version = 4;
