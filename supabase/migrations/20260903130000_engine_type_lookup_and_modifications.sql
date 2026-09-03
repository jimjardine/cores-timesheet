-- Third round of engine-table fixes, all from Jim's live feedback after the
-- last pass:
-- 1. Engine Type should be an open, addable list (like component_types), not
--    a fixed 5-value picklist — a shop occasionally has an engine that doesn't
--    fit Main/Aux/Genset/Emergency/Spare and needs to add its own category.
-- 2. Status (Active/Removed) replaced with a terminated_date — when an engine
--    is decommissioned, the office wants to know *when*, not just a flag.
-- 3. New: track known modifications to an engine (e.g. an oversized piston
--    liner) — a checkbox, a description, and the date it was done.

-- ── engine_types: converging lookup, same shape/posture as component_types ──
CREATE TABLE "Cores".engine_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "Cores".engine_types ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Cores".engine_types TO anon, authenticated;
CREATE POLICY "engine_types_select" ON "Cores".engine_types FOR SELECT USING (true);
CREATE POLICY "engine_types_insert" ON "Cores".engine_types FOR INSERT WITH CHECK (true);
CREATE POLICY "engine_types_update" ON "Cores".engine_types FOR UPDATE USING (true);
CREATE POLICY "engine_types_delete" ON "Cores".engine_types FOR DELETE USING (true);

CREATE TRIGGER audit_trg AFTER INSERT OR UPDATE OR DELETE ON "Cores".engine_types
  FOR EACH ROW EXECUTE FUNCTION "Cores".audit_trigger_fn();

-- Seed with the categories already agreed on last round, so nothing's lost —
-- the office can add more from the picker as real ones come up.
INSERT INTO "Cores".engine_types (name) VALUES ('Main'), ('Auxiliary'), ('Genset'), ('Emergency'), ('Spare');

-- No real data exists yet (zero rows on engines) — straight swap, no backfill.
ALTER TABLE "Cores".engines ADD COLUMN engine_type_id uuid REFERENCES "Cores".engine_types(id);
ALTER TABLE "Cores".engines DROP COLUMN engine_type;

-- Active/Removed status -> a real date. Null = still in service.
ALTER TABLE "Cores".engines ADD COLUMN terminated_date date;
ALTER TABLE "Cores".engines DROP COLUMN status;

-- Modification tracking — one flagged modification per engine (checkbox +
-- description + date), not a repeatable log like engine_service_log. If it
-- turns out engines need more than one on file, that's a follow-up.
ALTER TABLE "Cores".engines ADD COLUMN is_modified boolean NOT NULL DEFAULT false;
ALTER TABLE "Cores".engines ADD COLUMN modification_description text;
ALTER TABLE "Cores".engines ADD COLUMN modification_date date;
