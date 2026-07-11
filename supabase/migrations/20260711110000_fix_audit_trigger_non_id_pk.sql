-- audit_trigger_fn() assumed every table has an `id` column. payroll_config's primary
-- key is `key`, not `id` -- the very first write to that table after the audit_log
-- migration threw "record NEW has no field id". Falls back to `key` when `id` is absent.

create or replace function "Cores".audit_trigger_fn() returns trigger
language plpgsql security definer set search_path = 'Cores', 'pg_catalog' as $$
declare
  rec_id text;
begin
  if TG_OP = 'DELETE' then
    rec_id := coalesce(to_jsonb(OLD)->>'id', to_jsonb(OLD)->>'key');
    insert into "Cores".audit_log (table_name, record_id, action, old_data)
    values (TG_TABLE_NAME, rec_id, TG_OP, to_jsonb(OLD));
    return OLD;
  elsif TG_OP = 'UPDATE' then
    rec_id := coalesce(to_jsonb(NEW)->>'id', to_jsonb(NEW)->>'key');
    insert into "Cores".audit_log (table_name, record_id, action, old_data, new_data)
    values (TG_TABLE_NAME, rec_id, TG_OP, to_jsonb(OLD), to_jsonb(NEW));
    return NEW;
  else
    rec_id := coalesce(to_jsonb(NEW)->>'id', to_jsonb(NEW)->>'key');
    insert into "Cores".audit_log (table_name, record_id, action, new_data)
    values (TG_TABLE_NAME, rec_id, TG_OP, to_jsonb(NEW));
    return NEW;
  end if;
end;
$$;
