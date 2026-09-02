-- Step 5b Tasks 7-9: round-scoped canonical finding, immutable per-reviewer
-- report, and one reconciliation decision per finding, replacing the fused
-- finding row a legacy panel upserted over. `finding` now owns identity only;
-- `finding_report` owns what one reviewer asserted; `finding_decision` owns
-- the author's one typed answer. Every existing finding row survives under
-- round 1, with one finding_report row when it carried a producing
-- agent_run_id — nothing here manufactures a second reviewer.

ALTER TABLE finding RENAME TO finding_legacy_003;

CREATE TABLE finding (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id   INTEGER NOT NULL REFERENCES stage(id),
  round      INTEGER NOT NULL,
  intent_key TEXT NOT NULL,
  location   TEXT NOT NULL,
  UNIQUE (stage_id, round, intent_key, location)
);

CREATE TABLE finding_report (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id     INTEGER NOT NULL REFERENCES finding(id),
  agent_run_id   INTEGER NOT NULL REFERENCES agent_run(id),
  severity       TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  classification TEXT NOT NULL CHECK (classification IN ('current_artifact', 'upstream')),
  subject        TEXT NOT NULL,
  UNIQUE (finding_id, agent_run_id)
);

CREATE TABLE finding_decision (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id           INTEGER NOT NULL REFERENCES finding(id),
  agent_run_id         INTEGER NOT NULL REFERENCES agent_run(id),
  disposition          TEXT NOT NULL CHECK (disposition IN ('addressed', 'rejected_with_rationale', 'upstream_follow_up', 'upstream_blocking', 'cannot_determine')),
  rationale            TEXT NOT NULL,
  changed_locations    TEXT NOT NULL,
  grounding_source     TEXT,
  grounding_location   TEXT,
  grounding_excerpt    TEXT,
  normative_changes    TEXT,
  artifact_hash_before TEXT NOT NULL,
  artifact_hash_after  TEXT NOT NULL,
  UNIQUE (finding_id)
);

INSERT INTO finding (id, stage_id, round, intent_key, location)
  SELECT id, stage_id, 1, intent_key, location FROM finding_legacy_003;

-- Classification is derived from the location the legacy row already carried,
-- never assumed. The old fused table had no classification column, but an
-- upstream report's location is classification-bound: `validateReviewerReports`
-- required one of the two exact `upstream:<source>:` prefixes for it and
-- forbade that prefix on a current-artifact report, and the legacy stages
-- stored that validated location verbatim. Writing a literal
-- 'current_artifact' here would pair a reviewer's severity and subject with a
-- classification the reviewer did not return — manufactured immutable
-- evidence, durable once the legacy table is dropped below.
INSERT INTO finding_report (finding_id, agent_run_id, severity, classification, subject)
  SELECT id, agent_run_id, severity,
         CASE
           WHEN location LIKE 'upstream:design:%' THEN 'upstream'
           WHEN location LIKE 'upstream:specification:%' THEN 'upstream'
           ELSE 'current_artifact'
         END,
         subject
  FROM finding_legacy_003
  WHERE agent_run_id IS NOT NULL;

DROP TABLE finding_legacy_003;

PRAGMA user_version = 5;
