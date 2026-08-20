-- URGENT FIX: the 'draft' status added tonight for the mobile app's
-- "Submit day" feature (EmployeeHome.jsx's ensureDaySubId/autosaveLog) was
-- never added to this check constraint — every single mobile-app autosave
-- since that feature shipped has been failing with a silent 400
-- ("violates check constraint sms_submissions_status_check"), which the UI
-- swallows with no visible error. Confirmed live: reproduced the exact
-- failure a tech reported ("everything disappeared after Save"), traced to
-- this constraint via a direct REST call.
ALTER TABLE "Cores".sms_submissions DROP CONSTRAINT IF EXISTS sms_submissions_status_check;
ALTER TABLE "Cores".sms_submissions
  ADD CONSTRAINT sms_submissions_status_check
  CHECK (status = ANY (ARRAY['draft'::text, 'collecting'::text, 'submitted'::text, 'approved'::text, 'rejected'::text]));
