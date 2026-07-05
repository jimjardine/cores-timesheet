-- Supplies used on jobs, captured via SMS alongside hours.
-- No pricing here — quantities only; dollars are added at invoicing time.
CREATE TABLE IF NOT EXISTS public.job_supplies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE,
  sms_submission_id UUID REFERENCES public.sms_submissions(id) ON DELETE SET NULL,
  employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  work_date DATE NOT NULL,
  supply_name TEXT NOT NULL,
  quantity NUMERIC(8,2) NOT NULL DEFAULT 1,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_supplies_job_id ON public.job_supplies(job_id);
CREATE INDEX IF NOT EXISTS idx_job_supplies_work_date ON public.job_supplies(work_date);

ALTER TABLE public.job_supplies ENABLE ROW LEVEL SECURITY;

-- Same posture as the rest of the app until real auth lands (backlog #12).
-- Table-level grants are needed too — new tables don't get them by default here.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_supplies TO anon, authenticated;
CREATE POLICY "job_supplies_select" ON public.job_supplies FOR SELECT USING (true);
CREATE POLICY "job_supplies_insert" ON public.job_supplies FOR INSERT WITH CHECK (true);
CREATE POLICY "job_supplies_update" ON public.job_supplies FOR UPDATE USING (true);
CREATE POLICY "job_supplies_delete" ON public.job_supplies FOR DELETE USING (true);

-- Parsed supplies live on the submission until Nicki approves
ALTER TABLE public.sms_submissions
  ADD COLUMN IF NOT EXISTS supplies JSONB DEFAULT '[]'::jsonb;
