-- Replaces week-level Sage posting with day-level: posting always happens after
-- Niki reviews and confirms one specific day, not a whole week at once. The old
-- weekly_summary_posted table only ever held 2 rows (both test data from
-- 2026-07), so it's dropped rather than migrated.
DROP TABLE IF EXISTS "Cores".weekly_summary_posted;

CREATE TABLE "Cores".daily_summary_posted (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES "Cores".employees(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  posted_at timestamp with time zone NOT NULL DEFAULT now(),
  posted_by text,
  UNIQUE (employee_id, work_date)
);

CREATE INDEX idx_daily_summary_posted_date ON "Cores".daily_summary_posted(work_date);

ALTER TABLE "Cores".daily_summary_posted ENABLE ROW LEVEL SECURITY;

-- Same posture as the rest of the app until real auth lands
GRANT SELECT, INSERT, UPDATE, DELETE ON "Cores".daily_summary_posted TO anon, authenticated;
CREATE POLICY "daily_summary_posted_select" ON "Cores".daily_summary_posted FOR SELECT USING (true);
CREATE POLICY "daily_summary_posted_insert" ON "Cores".daily_summary_posted FOR INSERT WITH CHECK (true);
CREATE POLICY "daily_summary_posted_update" ON "Cores".daily_summary_posted FOR UPDATE USING (true);
CREATE POLICY "daily_summary_posted_delete" ON "Cores".daily_summary_posted FOR DELETE USING (true);

-- audit trail, same as other business tables
CREATE TRIGGER audit_trg AFTER INSERT OR UPDATE OR DELETE ON "Cores".daily_summary_posted
  FOR EACH ROW EXECUTE FUNCTION "Cores".audit_trigger_fn();
