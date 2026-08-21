-- The bot infers a job number for a job-less text by assuming the tech is
-- still on whatever job they last reported (same day, then falling back to
-- the most recent prior day) — deliberately quiet, never asks. Greg rarely
-- states a job number and moves between jobs enough that this guess is
-- often wrong for him specifically; the office would rather see the day
-- saved with no job at all ("office will match the job") than a silent
-- wrong guess. Per-employee flag, same pattern as confirmation_exempt
-- (20260817180000) — not hardcoding a name in application code.
ALTER TABLE "Cores".employees
  ADD COLUMN IF NOT EXISTS job_inference_exempt boolean NOT NULL DEFAULT false;

UPDATE "Cores".employees SET job_inference_exempt = true WHERE name = 'Greg MacIntyre';
