-- Tracy bills consumable supplies to customers by job number, sometimes in
-- stages as a job progresses. Nothing today tracks whether a given supply
-- usage has already been charged, so there's real risk of double-billing.
-- job_supplies was deliberately built with no billing state at all ("No
-- pricing here — quantities only; dollars are added at invoicing time," per
-- its original migration comment) — this is genuinely new territory, not an
-- existing concept being extended.
--
-- billed_at/billed_by mirrors the existing approved_at/approved_by_name
-- convention on timesheet_entries exactly: a denormalized name column (no
-- per-admin accounts yet), stamped via PasswordGate's getAdminName().
-- billed_at IS NOT NULL is the flag; clearing it is a normal, fully
-- reversible update — same posture as everything else in this app that
-- isn't already-approved payroll data.
--
-- source_photo_id links a supply row back to the gear_photos row it was
-- logged from, when it was created that way (nullable — most supply rows
-- still come from a texted-in report, not a photo). Gives a real link where
-- today Reports.jsx only has a coincidental job/employee/date grouping
-- match between the two tables.
ALTER TABLE "Cores".job_supplies
  ADD COLUMN billed_at timestamptz,
  ADD COLUMN billed_by text,
  ADD COLUMN source_photo_id uuid REFERENCES "Cores".gear_photos(id) ON DELETE SET NULL;

CREATE INDEX idx_job_supplies_billed_at ON "Cores".job_supplies(billed_at);
