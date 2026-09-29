-- Per-setting model and effort (2026-09-29): each dispatch requests a model and
-- an effort level resolved from the frozen profile's `dispatchSettings`.
-- `requested_effort` records the level the run asked the harness for. The stream
-- reports no effective effort, so only the request is recorded. `setting` names
-- which setting governed the row (an agent id, or `reconciler` for a
-- reconciliation dispatch), so two rows by one agent that differ only in
-- setting are told apart without depending on row order. Both columns are
-- nullable because rows written before this migration exist in old stores; a
-- row written by this code always carries both.

ALTER TABLE agent_run ADD COLUMN requested_effort TEXT;
ALTER TABLE agent_run ADD COLUMN setting TEXT;

PRAGMA user_version = 8;
