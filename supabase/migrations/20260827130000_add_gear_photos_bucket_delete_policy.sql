-- storage.objects for the gear-photos bucket only ever got INSERT/SELECT
-- policies (20260817190000, for direct client uploads) — DELETE was never
-- added. GearPhotos.jsx's "Delete this photo" (remove(), which calls
-- supabase.storage.from('gear-photos').remove(...) before deleting the row)
-- has been failing with an RLS error in production ever since: the storage
-- delete errors out, the function bails before touching the gear_photos row,
-- and the user just sees "Error deleting file: ...". Same permissive posture
-- as every other policy on this bucket/table pair (see gear_photos' own
-- USING(true) policies) — no real auth yet, anon and authenticated are
-- equivalent everywhere else in this app.
CREATE POLICY "gear_photos_bucket_delete" ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (bucket_id = 'gear-photos');
