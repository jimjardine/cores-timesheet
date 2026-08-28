-- A day off, reported by texting "day off" or tapping the mobile app's Day
-- Off button — a positive "I'm intentionally not working today" signal, not
-- a missing report. No hours, no job, no review needed (nothing for the
-- office to check), auto-inserted the moment it's reported. Flagged so
-- reports can tell it apart from real hours, same convention as is_stat_pay.
ALTER TABLE "Cores".timesheet_entries
  ADD COLUMN IF NOT EXISTS is_day_off boolean NOT NULL DEFAULT false;

-- Same race as ensureStatPay's check-then-insert (texting "day off" twice,
-- or texting it while also tapping the app button, around the same time) —
-- make a second concurrent insert fail instead of doubling the row.
CREATE UNIQUE INDEX IF NOT EXISTS timesheet_entries_one_day_off_per_day
  ON "Cores".timesheet_entries (employee_id, work_date)
  WHERE is_day_off = true;
