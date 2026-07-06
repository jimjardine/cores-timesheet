-- Stat-holiday pay entries: auto-granted 8-hr entries for employees who worked
-- that pay week. Flagged so reports can tell stat pay from hours actually worked.
ALTER TABLE "Cores".timesheet_entries
  ADD COLUMN IF NOT EXISTS is_stat_pay boolean NOT NULL DEFAULT false;
