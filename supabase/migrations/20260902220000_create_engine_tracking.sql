-- Engine tracking: office-side (admin-only) record of the engines on each vessel,
-- the individual parts on those engines (each has its own serial number — e.g. a
-- V16's pistons are referred to as "Left1"/"Right8"), and a service history log.
-- Nothing here is tech-facing — techs keep logging hours exactly as they do today,
-- job number only. This is deliberately decoupled from job granularity: one job
-- (work order) can cover multiple engines (e.g. "rebuild 2 generators" as a single
-- job #), and engine_service_log is where the per-engine detail actually lives —
-- one row per engine per service event, all pointing back at the same work_order_id
-- if that's how the office billed it.

-- ── Vessel photo ──
ALTER TABLE "Cores".vessels ADD COLUMN photo_storage_path text;

-- ── Work order file/link, at the job level (the work order covers the whole job,
-- not any one engine specifically) ──
ALTER TABLE "Cores".jobs ADD COLUMN work_order_file_path text;
ALTER TABLE "Cores".jobs ADD COLUMN work_order_link text;

-- ── component_types: a converging lookup list, not a hardcoded enum — the intent
-- is Niki/Tracy pick from what already exists or add a new one inline, so the same
-- part doesn't end up filed under three different spellings. ──
CREATE TABLE "Cores".component_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "Cores".component_types ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Cores".component_types TO anon, authenticated;
CREATE POLICY "component_types_select" ON "Cores".component_types FOR SELECT USING (true);
CREATE POLICY "component_types_insert" ON "Cores".component_types FOR INSERT WITH CHECK (true);
CREATE POLICY "component_types_update" ON "Cores".component_types FOR UPDATE USING (true);
CREATE POLICY "component_types_delete" ON "Cores".component_types FOR DELETE USING (true);

CREATE TRIGGER audit_trg AFTER INSERT OR UPDATE OR DELETE ON "Cores".component_types
  FOR EACH ROW EXECUTE FUNCTION "Cores".audit_trigger_fn();

-- ── engines: one row per engine on a vessel — two mains plus however many
-- auxiliary/generator engines. engine_type and status are plain text (not a CHECK
-- constraint), same posture as jobs.status/vessels.status elsewhere in this schema
-- — validated in the app, not the DB, so a new value never needs a migration to
-- ship (see the 2026-08-19 incident on sms_submissions.status for why that
-- specific failure mode is avoided here on purpose). kw, not horsepower — this
-- shop always specs engines in kilowatts.
CREATE TABLE "Cores".engines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id uuid NOT NULL REFERENCES "Cores".vessels(id) ON DELETE CASCADE,
  engine_type text NOT NULL, -- 'main' | 'auxiliary'
  label text NOT NULL, -- "Port", "Stbd", "Generator 1"
  manufacturer text,
  model text,
  serial_number text,
  cylinder_count integer,
  kw numeric,
  install_date date,
  hours numeric,
  hours_updated_at date,
  status text NOT NULL DEFAULT 'active',
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_engines_vessel ON "Cores".engines(vessel_id);

ALTER TABLE "Cores".engines ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Cores".engines TO anon, authenticated;
CREATE POLICY "engines_select" ON "Cores".engines FOR SELECT USING (true);
CREATE POLICY "engines_insert" ON "Cores".engines FOR INSERT WITH CHECK (true);
CREATE POLICY "engines_update" ON "Cores".engines FOR UPDATE USING (true);
CREATE POLICY "engines_delete" ON "Cores".engines FOR DELETE USING (true);

CREATE TRIGGER audit_trg AFTER INSERT OR UPDATE OR DELETE ON "Cores".engines
  FOR EACH ROW EXECUTE FUNCTION "Cores".audit_trigger_fn();

-- ── engine_components: part-level serial-number tracking within an engine —
-- e.g. a V16's pistons/liners/injectors, each referred to by position ("Left1",
-- "Right8") rather than a generic index. ──
CREATE TABLE "Cores".engine_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engine_id uuid NOT NULL REFERENCES "Cores".engines(id) ON DELETE CASCADE,
  position_label text NOT NULL, -- "Left1", "Right8"
  component_type_id uuid NOT NULL REFERENCES "Cores".component_types(id),
  serial_number text,
  install_date date,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_engine_components_engine ON "Cores".engine_components(engine_id);
CREATE INDEX idx_engine_components_type ON "Cores".engine_components(component_type_id);

ALTER TABLE "Cores".engine_components ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Cores".engine_components TO anon, authenticated;
CREATE POLICY "engine_components_select" ON "Cores".engine_components FOR SELECT USING (true);
CREATE POLICY "engine_components_insert" ON "Cores".engine_components FOR INSERT WITH CHECK (true);
CREATE POLICY "engine_components_update" ON "Cores".engine_components FOR UPDATE USING (true);
CREATE POLICY "engine_components_delete" ON "Cores".engine_components FOR DELETE USING (true);

CREATE TRIGGER audit_trg AFTER INSERT OR UPDATE OR DELETE ON "Cores".engine_components
  FOR EACH ROW EXECUTE FUNCTION "Cores".audit_trigger_fn();

-- ── engine_service_log: one row per service event per engine. work_order_id links
-- back to the job it was billed under (nullable — not every service event
-- necessarily has one on file) so one job covering several engines still gets
-- per-engine detail: N engines serviced under the same work order is N rows here,
-- same work_order_id, different engine_id. performed_by is plain text (not an
-- employees FK) since service is sometimes done by an outside shop, not just crew.
CREATE TABLE "Cores".engine_service_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engine_id uuid NOT NULL REFERENCES "Cores".engines(id) ON DELETE CASCADE,
  service_date date NOT NULL,
  description text,
  hours_at_service numeric,
  performed_by text,
  work_order_id uuid REFERENCES "Cores".jobs(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_engine_service_log_engine ON "Cores".engine_service_log(engine_id);
CREATE INDEX idx_engine_service_log_work_order ON "Cores".engine_service_log(work_order_id);

ALTER TABLE "Cores".engine_service_log ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Cores".engine_service_log TO anon, authenticated;
CREATE POLICY "engine_service_log_select" ON "Cores".engine_service_log FOR SELECT USING (true);
CREATE POLICY "engine_service_log_insert" ON "Cores".engine_service_log FOR INSERT WITH CHECK (true);
CREATE POLICY "engine_service_log_update" ON "Cores".engine_service_log FOR UPDATE USING (true);
CREATE POLICY "engine_service_log_delete" ON "Cores".engine_service_log FOR DELETE USING (true);

CREATE TRIGGER audit_trg AFTER INSERT OR UPDATE OR DELETE ON "Cores".engine_service_log
  FOR EACH ROW EXECUTE FUNCTION "Cores".audit_trigger_fn();

-- ── work-order-docs bucket: separate from gear-photos since work orders are
-- typically PDFs, not photos/video. Vessel photos reuse the existing gear-photos
-- bucket instead (under a vessels/ storage prefix) since those are plain images,
-- same shape as everything else already in that bucket.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('work-order-docs', 'work-order-docs', true, 26214400, ARRAY['application/pdf','image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "work_order_docs_bucket_select" ON storage.objects FOR SELECT USING (bucket_id = 'work-order-docs');
CREATE POLICY "work_order_docs_bucket_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'work-order-docs');
CREATE POLICY "work_order_docs_bucket_delete" ON storage.objects FOR DELETE USING (bucket_id = 'work-order-docs');
