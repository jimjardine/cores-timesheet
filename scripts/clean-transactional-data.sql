ALTER TABLE "Cores".sms_submissions DISABLE ROW LEVEL SECURITY;
ALTER TABLE "Cores".timesheet_entries DISABLE ROW LEVEL SECURITY;
ALTER TABLE "Cores".job_supplies DISABLE ROW LEVEL SECURITY;

DELETE FROM "Cores".sms_submissions;
DELETE FROM "Cores".timesheet_entries;
DELETE FROM "Cores".job_supplies;

ALTER TABLE "Cores".sms_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Cores".timesheet_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Cores".job_supplies ENABLE ROW LEVEL SECURITY;

SELECT 'sms_submissions' AS table_name, COUNT(*) AS row_count FROM "Cores".sms_submissions
UNION ALL
SELECT 'timesheet_entries', COUNT(*) FROM "Cores".timesheet_entries
UNION ALL
SELECT 'job_supplies', COUNT(*) FROM "Cores".job_supplies
ORDER BY table_name;
