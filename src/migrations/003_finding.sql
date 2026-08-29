CREATE TABLE finding (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id     INTEGER NOT NULL REFERENCES stage(id),
  agent_run_id INTEGER REFERENCES agent_run(id),
  severity     TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  intent_key   TEXT NOT NULL,
  subject      TEXT NOT NULL,
  location     TEXT NOT NULL,
  disposition  TEXT NOT NULL DEFAULT 'open'
               CHECK (disposition IN ('open', 'resolved', 'disputed', 'accepted')),
  UNIQUE (stage_id, intent_key, location)
);

PRAGMA user_version = 3;
