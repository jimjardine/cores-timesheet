-- Deactivating an employee (todo #19 follow-up) only ever blocked a NEW login
-- (employee-auth already checks active) — an already-logged-in phone's
-- localStorage session had no server-side check at all, so a departed
-- employee's stale session could keep inserting real sms_submissions rows
-- indefinitely. Niki's approval gate means this was never a pay risk (per
-- Jim, 2026-08-27) — just garbage data cluttering SMS Review — but worth
-- closing at the DB level since the app never re-validates a cached session.
--
-- Scoped narrowly to from_phone = 'mobile-app' (the mobile self-entry path,
-- src/employee/EmployeeHome.jsx + EntryForm.jsx) so this can't ever block:
--   - admin-manual entries (from_phone = 'admin-manual', entrySave.js) —
--     the office must still be able to log a final correction for someone
--     who's just quit or been deactivated.
--   - real SMS texts (from_phone = the actual phone number) — already
--     gated at the edge-function's employee lookup (todo #23, active=true
--     filter), so re-checking here would be redundant, not protective.

DROP POLICY IF EXISTS "anon full access sms_submissions" ON "Cores".sms_submissions;

CREATE POLICY "anon select" ON "Cores".sms_submissions
  FOR SELECT USING (true);

CREATE POLICY "anon update" ON "Cores".sms_submissions
  FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "anon delete" ON "Cores".sms_submissions
  FOR DELETE USING (true);

CREATE POLICY "anon insert" ON "Cores".sms_submissions
  FOR INSERT WITH CHECK (
    from_phone <> 'mobile-app'
    OR EXISTS (
      SELECT 1 FROM "Cores".employees e
      WHERE e.id = employee_id AND e.active
    )
  );
