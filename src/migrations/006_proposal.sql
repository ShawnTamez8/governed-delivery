-- Step 5b Task 8: an upstream concern's durable, queryable, non-binding
-- destination. A proposal is derived from a validated reconciliation
-- decision (upstream_follow_up or upstream_blocking); route is derived from
-- the disposition, never a second model-returned field. `identity` is the
-- deterministic dedup key (stage, normalized title, problem, and route) so
-- the same concern raised again links an additional source finding rather
-- than fusing content across decisions or minting a duplicate row.

CREATE TABLE proposal (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        INTEGER NOT NULL REFERENCES run(id),
  stage_id      INTEGER NOT NULL REFERENCES stage(id),
  identity      TEXT NOT NULL,
  title         TEXT NOT NULL,
  problem       TEXT NOT NULL,
  why_upstream  TEXT NOT NULL,
  route         TEXT NOT NULL CHECK (route IN ('follow_up', 'blocking_dependency')),
  evidence_ref  TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  UNIQUE (stage_id, identity)
);

CREATE TABLE proposal_source (
  proposal_id INTEGER NOT NULL REFERENCES proposal(id),
  finding_id  INTEGER NOT NULL REFERENCES finding(id),
  UNIQUE (proposal_id, finding_id)
);

PRAGMA user_version = 6;
