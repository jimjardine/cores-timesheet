-- The gear-photos bucket previously only ever received uploads from the
-- sms-timesheet edge function (service role, bypasses RLS). The mobile app
-- now uploads photos directly from the browser (anon key), which needs its
-- own storage.objects policy — same permissive posture as the rest of this
-- app (see Cores.gear_photos' own USING(true) policies).
CREATE POLICY "gear_photos_bucket_insert" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'gear-photos');

CREATE POLICY "gear_photos_bucket_select" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'gear-photos');
