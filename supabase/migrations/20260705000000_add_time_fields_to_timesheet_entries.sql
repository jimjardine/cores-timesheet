-- Add time_in, stated_time_out, and lunch_minutes to timesheet_entries for consistency
ALTER TABLE public.timesheet_entries
  ADD COLUMN time_in time without time zone,
  ADD COLUMN stated_time_out time without time zone,
  ADD COLUMN lunch_minutes integer;
