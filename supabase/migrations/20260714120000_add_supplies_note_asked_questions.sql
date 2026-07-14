-- The bot was re-asking questions the tech had already answered (shop supplies
-- especially): the "supplies are in my gear photo" answer only lived in a display
-- flag, and the record of what had been asked only lived in pending_questions —
-- which gets cleared on submit and by SMS Review edits. Persist both.
ALTER TABLE "Cores".sms_submissions
  ADD COLUMN IF NOT EXISTS supplies_note text,
  ADD COLUMN IF NOT EXISTS asked_questions jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN "Cores".sms_submissions.supplies_note IS
  'How the supplies question was answered when not itemized: ''photo'' = in a gear photo, ''none'' = no supplies used, null = unanswered';
COMMENT ON COLUMN "Cores".sms_submissions.asked_questions IS
  'Every follow-up question ever asked in this conversation — unlike pending_questions this is never cleared, so a reopened conversation never re-asks';
