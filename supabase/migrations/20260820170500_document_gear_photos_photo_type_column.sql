-- gear_photos.photo_type has been live in the database and read/written by
-- both GearPhotos.jsx and the sms-timesheet edge function's low-stock
-- detection for a while now, but was never added through a tracked
-- migration — pure schema drift. Documenting it here so the migration
-- history matches reality, rather than adding functionality.
--
-- IF NOT EXISTS makes this safe to run against the already-live column.
-- Confirmed live values are exactly 'supply', 'reference', or null
-- (checked directly against production before adding the CHECK below).
ALTER TABLE "Cores".gear_photos
  ADD COLUMN IF NOT EXISTS photo_type text;

ALTER TABLE "Cores".gear_photos
  DROP CONSTRAINT IF EXISTS gear_photos_photo_type_check;

ALTER TABLE "Cores".gear_photos
  ADD CONSTRAINT gear_photos_photo_type_check
  CHECK (photo_type IS NULL OR photo_type IN ('supply', 'reference'));
