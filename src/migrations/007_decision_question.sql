-- Spec operator decisions (2026-09-27): a spec_review decision the author
-- chose as upstream_blocking or cannot_determine carries a question the
-- operator answers instead of ending the run. `decision_question` stores no
-- stage of its own: `finding.stage_id` is the one authority for which stage
-- owns a question, so every read joins through the finding. One answer per
-- question, ever; a mistaken answer is repaired by a fresh run.

CREATE TABLE decision_question (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id  INTEGER NOT NULL REFERENCES finding(id),
  text        TEXT NOT NULL,
  options     TEXT NOT NULL,
  recommended INTEGER NOT NULL,
  why         TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE (finding_id)
);

CREATE TABLE decision_answer (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES decision_question(id),
  action      TEXT NOT NULL CHECK (action IN ('approve', 'deny', 'modify')),
  answer      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE (question_id)
);

PRAGMA user_version = 7;
