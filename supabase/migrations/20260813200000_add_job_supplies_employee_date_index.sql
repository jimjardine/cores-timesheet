-- Entry-save (replaceSupplies in src/utils/entrySave.js) and the employee self-
-- service views (EntryForm.jsx, EmployeeHome.jsx) always filter job_supplies by
-- employee_id equality plus a work_date equality or range
-- (.eq('employee_id', ...).eq('work_date', ...) / .gte(...).lte(...)), never by
-- work_date alone without an employee_id. The existing idx_job_supplies_work_date
-- (work_date only) doesn't serve that pattern well since it can't narrow by
-- employee first. A composite index with employee_id first (equality column)
-- and work_date second (range/equality column) matches this access pattern and
-- also fully covers plain employee_id-only lookups.
CREATE INDEX IF NOT EXISTS idx_job_supplies_employee_work_date
  ON "Cores".job_supplies (employee_id, work_date);
