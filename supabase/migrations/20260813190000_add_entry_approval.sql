-- Supports printing a supervisor "signature" on the daily timesheet PDF.
-- Denormalized (name, not employee_id FK) to match the existing pattern on
-- this table where time_in/stated_time_out/lunch_minutes are copied onto
-- each entry rather than joined. No per-admin login exists yet, so callers
-- currently stamp a hardcoded name here (see CURRENT_APPROVER in
-- SmsReview.jsx / AdminDashboard.jsx) — swap to the real logged-in admin's
-- name once per-user admin login ships (todo.md #14).
ALTER TABLE "Cores".timesheet_entries
  ADD COLUMN IF NOT EXISTS approved_by_name text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;
