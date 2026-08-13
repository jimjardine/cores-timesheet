-- 20260711110000_fix_audit_trigger_non_id_pk.sql taught audit_trigger_fn() to fall
-- back from `id` to `key` (for payroll_config). But coalesce(to_jsonb(NEW)->>'id',
-- to_jsonb(NEW)->>'key') silently returns NULL when a table has NEITHER column,
-- instead of erroring the way the original OLD.id/NEW.id field access used to.
-- That's worse than the bug it fixed: a bad audit_log row (record_id = NULL) is
-- easy to miss, where the original "record NEW has no field id" at least failed
-- loudly at the first write.
--
-- Checked every table this trigger is actually attached to (20260711000000 and
-- later CREATE TRIGGER audit_trg statements): employees, customers, vessels,
-- jobs, job_tasks, timesheet_entries, stat_holidays, job_status_logs,
-- vessel_contacts, sms_submissions, job_supplies, gear_photos and
-- weekly_summary_posted all key on `id`; payroll_config keys on `key`. So `id`
-- then `key` covers every table the trigger currently runs on. But the schema
-- already has at least one table with a different PK shape entirely —
-- employee_auth keys on `employee_id` (20260727120000) — that simply has no
-- audit trigger today. If a trigger is ever added to a table like that without
-- updating this function, silently writing record_id = NULL would corrupt the
-- audit trail without so much as a log line.
--
-- Restore the original erroring behavior for that genuinely-unmatched case,
-- while keeping the `id`/`key` fallback that's actually needed today.
create or replace function "Cores".audit_trigger_fn() returns trigger
language plpgsql security definer set search_path = 'Cores', 'pg_catalog' as $$
declare
  rec_id text;
  rec_jsonb jsonb;
begin
  rec_jsonb := to_jsonb(case when TG_OP = 'DELETE' then OLD else NEW end);

  if rec_jsonb ? 'id' then
    rec_id := rec_jsonb ->> 'id';
  elsif rec_jsonb ? 'key' then
    rec_id := rec_jsonb ->> 'key';
  else
    raise exception 'audit_trigger_fn: table "%" has no id or key column to use as audit_log.record_id — update audit_trigger_fn to handle its primary key', TG_TABLE_NAME;
  end if;

  if TG_OP = 'DELETE' then
    insert into "Cores".audit_log (table_name, record_id, action, old_data)
    values (TG_TABLE_NAME, rec_id, TG_OP, to_jsonb(OLD));
    return OLD;
  elsif TG_OP = 'UPDATE' then
    insert into "Cores".audit_log (table_name, record_id, action, old_data, new_data)
    values (TG_TABLE_NAME, rec_id, TG_OP, to_jsonb(OLD), to_jsonb(NEW));
    return NEW;
  else
    insert into "Cores".audit_log (table_name, record_id, action, new_data)
    values (TG_TABLE_NAME, rec_id, TG_OP, to_jsonb(NEW));
    return NEW;
  end if;
end;
$$;
