-- Some office staff (e.g. Tracy) key in their own manual timesheet entries on
-- a fixed weekly schedule (see defaultScheduleFor in AdminDashboard.jsx) —
-- texting them to "confirm" a shift they just typed in themselves is pure
-- overhead. Per-employee flag, same pattern as ot_daily_threshold/
-- ot_friday_threshold, rather than hardcoding a name in application code.
ALTER TABLE "Cores".employees
  ADD COLUMN IF NOT EXISTS confirmation_exempt boolean NOT NULL DEFAULT false;

UPDATE "Cores".employees SET confirmation_exempt = true WHERE name = 'Tracy Stewart';
