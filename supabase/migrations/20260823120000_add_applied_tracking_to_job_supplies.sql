-- Tracy's gear-photo supply logging used to be one click ("+ Log as supply")
-- that immediately created a real, billable job_supplies row. The new photo
-- UI instead lets her fill in description/quantity as a draft that autosaves
-- while she's still typing, with a separate deliberate "Apply to Timesheet"
-- step before it's real. applied_at/applied_by marks that moment, mirroring
-- the existing billed_at/billed_by convention exactly (denormalized name,
-- no per-admin accounts yet; NULL applied_at = draft, not yet on any report).
--
-- The other two producers of job_supplies (SMS-approved entries, and typed-in
-- supply rows on the manual/employee entry forms) are already a deliberate,
-- reviewed action with no draft step — those stamp applied_at at insert time
-- so they keep showing up everywhere immediately, same as before this change.
-- Only the gear-photo path leaves it null until she taps Apply.
--
-- Existing rows predate this column entirely and were already being billed/
-- reported on, so they're backfilled as applied at creation time rather than
-- left null (which would otherwise make every already-logged supply vanish
-- from the Supplies report, the billing checklist, and printed timesheets).
ALTER TABLE "Cores".job_supplies
  ADD COLUMN applied_at timestamptz,
  ADD COLUMN applied_by text;

UPDATE "Cores".job_supplies SET applied_at = created_at WHERE applied_at IS NULL;

CREATE INDEX idx_job_supplies_applied_at ON "Cores".job_supplies(applied_at);
