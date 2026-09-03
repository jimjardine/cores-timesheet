-- Second correction from Jim after seeing the first fix live:
-- - What we called "label" (free-text position like "PME"/"P Gen") was
--   actually meant to be a TYPE: the engine's application. Main, Aux,
--   Genset, Emergency, Spare — a picklist, not open text. engine_type
--   already existed for a narrower main/auxiliary split; widening its
--   accepted values to cover this instead of adding a redundant column.
--   (Still plain text, not a CHECK constraint or enum — validated in the
--   app, same posture as jobs.status/vessels.status elsewhere in this
--   schema, so a new value never needs a migration to ship.)
-- - Port vs starboard is real structured data on plenty of rows (PME =
--   Port Main Engine, SME = Stbd) but not all — "an engine could be
--   neither" — so it's a nullable side column, not folded into type.
-- - label itself no longer carries anything type+side don't already
--   capture, and no real data exists yet (zero rows) — dropped outright
--   rather than kept as a redundant free-text overflow field.
ALTER TABLE "Cores".engines DROP COLUMN label;
ALTER TABLE "Cores".engines ADD COLUMN side text; -- 'port' | 'starboard', nullable — plenty of engines are neither

COMMENT ON COLUMN "Cores".engines.arrangement_number IS
  'Manufacturer''s configuration/setup variant of this model, not a parts number — e.g. a CAT 3412 has a different arrangement number for a marine setup vs. a rail setup of the same base model.';
