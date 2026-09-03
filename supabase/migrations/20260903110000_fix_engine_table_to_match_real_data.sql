-- Jim shared the actual spreadsheet the office has been keeping (Company /
-- Vessel / Engine role / Manufacturer / Model / Serial # / Arrangement #) —
-- fixing the schema to match it before any real data goes in (no rows exist
-- yet, PR #84 shipped 2026-09-02 with zero usage so far).
--
-- Two mismatches against the real data:
-- 1. No arrangement_number column at all — a real column in the source
--    (CAT/manufacturer parts-arrangement number, distinct from serial #),
--    present on a meaningful chunk of rows (mostly CAT engines).
-- 2. label and engine_type were both NOT NULL, but real rows often have no
--    position label at all, and the position values that do exist ("PME",
--    "P Gen", "Spare", "Emergency", "ME #1"...) don't cleanly reduce to a
--    forced main/auxiliary pick at transcription time — better to let the
--    office set that later, once it's obvious, than block entry on it now.
ALTER TABLE "Cores".engines ADD COLUMN arrangement_number text;
ALTER TABLE "Cores".engines ALTER COLUMN label DROP NOT NULL;
ALTER TABLE "Cores".engines ALTER COLUMN engine_type DROP NOT NULL;
