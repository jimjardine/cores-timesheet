-- Day off requests (mobile app button + texted "day off") used to insert
-- directly into timesheet_entries, bypassing Niki's SMS Review entirely — a
-- deliberate call at the time ("nothing to check"), but Niki wants visibility
-- and control over these like everything else. Adding a flag so a day-off
-- request can be represented as a pending sms_submissions row instead, with
-- empty `entries` (no job/hours to review) and approve() creating the actual
-- day-off timesheet_entries row only once she approves it.
ALTER TABLE "Cores".sms_submissions ADD COLUMN is_day_off boolean NOT NULL DEFAULT false;
