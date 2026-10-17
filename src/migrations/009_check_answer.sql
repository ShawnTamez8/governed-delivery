-- The narration check (2026-10-17, docs/features/narration-check-spec-review/plan.md):
-- each spec-review round asks Decision-1 one typed question per acceptance
-- criterion. The call itself is an `agent_run` row (executor `systemone`; what
-- it saw, which model ran, what it cost), so a flagged criterion is reported
-- through the ordinary `finding_report`. This table holds the typed answer the
-- agent run returned, one row per question, flagged or not. It stores no stage
-- of its own: `agent_run.stage_id` is the one authority for which stage asked.
-- `finding_id` names the finding a flagged answer raised, and is null exactly
-- when the answer was not flagged.
--
-- A Decision-1 agent run carries a null `requested_effort` (Decision-1 has no
-- effort level) and a null `cost` (the response reports none: section 11
-- records a gap as a gap, never as a zero).

CREATE TABLE check_answer (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_run_id    INTEGER NOT NULL REFERENCES agent_run(id),
  check_name      TEXT NOT NULL CHECK (check_name IN ('narration')),
  subject         TEXT NOT NULL,
  question_hash   TEXT NOT NULL,
  state_hash      TEXT NOT NULL,
  endpoint        TEXT NOT NULL,
  deployment_type TEXT NOT NULL,
  choice          TEXT NOT NULL,
  probabilities   TEXT NOT NULL,
  threshold       REAL NOT NULL,
  flagged         INTEGER NOT NULL CHECK (flagged IN (0, 1)),
  finding_id      INTEGER REFERENCES finding(id),
  created_at      TEXT NOT NULL,
  UNIQUE (agent_run_id),
  CHECK ((flagged = 1) = (finding_id IS NOT NULL))
);

PRAGMA user_version = 9;
