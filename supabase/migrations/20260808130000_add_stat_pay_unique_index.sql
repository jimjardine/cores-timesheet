-- ensureStatPay() does a check-then-insert (select for an existing stat-pay
-- row, insert if none found) with no locking, so two concurrent calls for the
-- same employee/stat-day (e.g. an admin approving an SMS submission while the
-- employee saves via self-service around the same time) can both pass the
-- "no existing entry" check and both insert, doubling that day's stat pay.
-- This partial unique index makes a second concurrent insert fail instead of
-- succeeding; ensureStatPay treats that failure as "someone else already
-- granted it" and moves on. See FINDINGS_2026-08-08.md.
CREATE UNIQUE INDEX IF NOT EXISTS timesheet_entries_one_stat_pay_per_day
  ON "Cores".timesheet_entries (employee_id, work_date)
  WHERE is_stat_pay = true;
