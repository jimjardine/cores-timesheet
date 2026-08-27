-- Fourth photo_type alongside supply/reference/measurement: a photo of a
-- receipt for something bought on a job, tagged the same way from
-- GearPhotos.jsx.
ALTER TABLE "Cores".gear_photos
  DROP CONSTRAINT IF EXISTS gear_photos_photo_type_check;

ALTER TABLE "Cores".gear_photos
  ADD CONSTRAINT gear_photos_photo_type_check
  CHECK (photo_type IS NULL OR photo_type IN ('supply', 'reference', 'measurement', 'receipt'));
