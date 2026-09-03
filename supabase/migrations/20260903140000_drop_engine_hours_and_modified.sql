-- Both dropped on reflection, same reasoning: transactional events, not
-- static characteristics of the engine, so they don't belong on the engine
-- record itself.
-- - hours/hours_updated_at: a point-in-time reading, already captured
--   properly per-service-event via engine_service_log.hours_at_service.
-- - is_modified/modification_description/modification_date (added last
--   round): a modification is an event that happened at some point — that's
--   exactly what engine_service_log already exists to record. The engine's
--   existing free-text notes field stays as the general catch-all.
-- No real engine data exists yet — clean drop, no backfill.
ALTER TABLE "Cores".engines DROP COLUMN hours;
ALTER TABLE "Cores".engines DROP COLUMN hours_updated_at;
ALTER TABLE "Cores".engines DROP COLUMN is_modified;
ALTER TABLE "Cores".engines DROP COLUMN modification_description;
ALTER TABLE "Cores".engines DROP COLUMN modification_date;
