-- Niki needs to know who marked a week posted to Sage, not just when — the
-- PDF stamp and the Weekly Summary table both need to show "by {name}", same
-- denormalized-name convention as approved_by_name/billed_by/applied_by
-- elsewhere in this app (no per-admin accounts yet).
--
-- Nullable: existing rows predate this column and genuinely have no name to
-- backfill — left null rather than guessed.
ALTER TABLE "Cores".weekly_summary_posted
  ADD COLUMN posted_by text;
