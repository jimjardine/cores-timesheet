-- Tracks whether a given employee's pay week has been posted to payroll.
-- Informational only (no effect on editing) — presence of a row means posted;
-- deleting the row un-marks it.
CREATE TABLE IF NOT EXISTS "Cores".weekly_summary_posted (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES "Cores".employees(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  posted_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (employee_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_weekly_summary_posted_week ON "Cores".weekly_summary_posted(week_start);

ALTER TABLE "Cores".weekly_summary_posted ENABLE ROW LEVEL SECURITY;

-- Same posture as the rest of the app until real auth lands
GRANT SELECT, INSERT, UPDATE, DELETE ON "Cores".weekly_summary_posted TO anon, authenticated;
CREATE POLICY "weekly_summary_posted_select" ON "Cores".weekly_summary_posted FOR SELECT USING (true);
CREATE POLICY "weekly_summary_posted_insert" ON "Cores".weekly_summary_posted FOR INSERT WITH CHECK (true);
CREATE POLICY "weekly_summary_posted_update" ON "Cores".weekly_summary_posted FOR UPDATE USING (true);
CREATE POLICY "weekly_summary_posted_delete" ON "Cores".weekly_summary_posted FOR DELETE USING (true);

-- audit trail, same as other business tables
CREATE TRIGGER audit_trg AFTER INSERT OR UPDATE OR DELETE ON "Cores".weekly_summary_posted
  FOR EACH ROW EXECUTE FUNCTION "Cores".audit_trigger_fn();
