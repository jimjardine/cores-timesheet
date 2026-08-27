-- Third photo_type alongside 'supply'/'reference': a job photo of a
-- measurement taken on site (shaft diameter, prop pitch, etc.), tagged the
-- same way from GearPhotos.jsx. Filter bar also gained an "Untagged" button
-- for photo_type IS NULL — that's a read-only filter, no schema change needed.
ALTER TABLE "Cores".gear_photos
  DROP CONSTRAINT IF EXISTS gear_photos_photo_type_check;

ALTER TABLE "Cores".gear_photos
  ADD CONSTRAINT gear_photos_photo_type_check
  CHECK (photo_type IS NULL OR photo_type IN ('supply', 'reference', 'measurement'));
