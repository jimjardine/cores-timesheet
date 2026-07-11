-- Store gear photos texted in from the field
CREATE TABLE IF NOT EXISTS "Cores".gear_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES "Cores".employees(id) ON DELETE SET NULL,
  work_date date NOT NULL,
  from_phone text NOT NULL,
  storage_path text NOT NULL,
  file_size_bytes integer,
  message_text text,
  ship_or_job text,
  pending_context boolean NOT NULL DEFAULT false,
  photo_latitude numeric,
  photo_longitude numeric,
  photo_timestamp timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gear_photos_employee_date ON "Cores".gear_photos(employee_id, work_date);
CREATE INDEX IF NOT EXISTS idx_gear_photos_phone_date ON "Cores".gear_photos(from_phone, work_date);
CREATE INDEX IF NOT EXISTS idx_gear_photos_location ON "Cores".gear_photos(photo_latitude, photo_longitude) WHERE photo_latitude IS NOT NULL;

ALTER TABLE "Cores".gear_photos ENABLE ROW LEVEL SECURITY;

-- Same posture as the rest of the app until real auth lands
GRANT SELECT, INSERT, UPDATE, DELETE ON "Cores".gear_photos TO anon, authenticated;
CREATE POLICY "gear_photos_select" ON "Cores".gear_photos FOR SELECT USING (true);
CREATE POLICY "gear_photos_insert" ON "Cores".gear_photos FOR INSERT WITH CHECK (true);
CREATE POLICY "gear_photos_update" ON "Cores".gear_photos FOR UPDATE USING (true);
CREATE POLICY "gear_photos_delete" ON "Cores".gear_photos FOR DELETE USING (true);

-- audit trail, same as other business tables
CREATE TRIGGER audit_trg AFTER INSERT OR UPDATE OR DELETE ON "Cores".gear_photos
  FOR EACH ROW EXECUTE FUNCTION "Cores".audit_trigger_fn();

-- Storage bucket the edge function has been uploading to (previously missing entirely,
-- so uploads silently failed while the tech still got a "Got the photo" confirmation).
-- Public so the review UI can show images via plain public URLs, matching this app's
-- current no-auth access model everywhere else.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('gear-photos', 'gear-photos', true, 15728640, ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif'])
ON CONFLICT (id) DO NOTHING;
