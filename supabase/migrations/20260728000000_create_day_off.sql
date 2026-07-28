-- Lets a tech explicitly say "I didn't work this day" (mobile site or SMS),
-- so the office can tell "took the day off" apart from "forgot to submit" in
-- Submission Status. Deliberately not a timesheet_entries row (hours=0) —
-- that table's presence/absence drives OT-week and stat-pay eligibility math,
-- and a day-off marker shouldn't feed into either.
CREATE TABLE IF NOT EXISTS "Cores".day_off (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES "Cores".employees(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  note TEXT,
  source TEXT NOT NULL DEFAULT 'self', -- 'self' (mobile site) or 'sms'
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (employee_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_day_off_employee_date ON "Cores".day_off(employee_id, work_date);

ALTER TABLE "Cores".day_off ENABLE ROW LEVEL SECURITY;

-- Same open posture as the rest of the app until real auth lands.
GRANT SELECT, INSERT, UPDATE, DELETE ON "Cores".day_off TO anon, authenticated;
CREATE POLICY "day_off_select" ON "Cores".day_off FOR SELECT USING (true);
CREATE POLICY "day_off_insert" ON "Cores".day_off FOR INSERT WITH CHECK (true);
CREATE POLICY "day_off_update" ON "Cores".day_off FOR UPDATE USING (true);
CREATE POLICY "day_off_delete" ON "Cores".day_off FOR DELETE USING (true);
