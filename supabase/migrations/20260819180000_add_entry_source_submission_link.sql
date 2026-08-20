-- timesheet_entries and sms_submissions have only ever been linked
-- informally (matching employee_id + work_date), never by a real foreign
-- key — nothing in the database records which submission a given approved
-- entry actually came from. That gap is what let a submission that had
-- already been approved once get manually re-worked and end up looking
-- like a fresh, unrelated day to approve again (real incident: Nicolae
-- Ileshov, Aug 17 2026 — an already-approved entry and a since-edited
-- duplicate submission for the same day, nothing structurally tying them
-- together to catch it). Nullable: manual/self entries never came from a
-- submission at all. ON DELETE SET NULL, not CASCADE — deleting the
-- (unapproved, staging) submission later should never take a real,
-- already-paid entry down with it.
ALTER TABLE "Cores".timesheet_entries
  ADD COLUMN IF NOT EXISTS source_submission_id uuid REFERENCES "Cores".sms_submissions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS timesheet_entries_source_submission_id_idx
  ON "Cores".timesheet_entries(source_submission_id);
