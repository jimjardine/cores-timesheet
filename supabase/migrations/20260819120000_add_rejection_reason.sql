-- Rejecting a submission (SmsReview's "Delete" button) previously left no
-- record of why — the tech just saw a bare "declined" chip with nothing to
-- go on. Free text, entered by the admin at the moment they reject it.
ALTER TABLE "Cores".sms_submissions
  ADD COLUMN IF NOT EXISTS rejection_reason text;
