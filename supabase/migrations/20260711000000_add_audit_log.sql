create table "Cores".audit_log (
  id bigserial primary key,
  table_name text not null,
  record_id text not null,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  old_data jsonb,
  new_data jsonb,
  changed_at timestamptz not null default now()
);
create index audit_log_table_record_idx on "Cores".audit_log (table_name, record_id);
create index audit_log_changed_at_idx on "Cores".audit_log (changed_at);

alter table "Cores".audit_log enable row level security;
-- no policies — not reachable via anon/authenticated, only via SQL editor/service role

create or replace function "Cores".audit_trigger_fn() returns trigger
language plpgsql security definer set search_path = 'Cores', 'pg_catalog' as $$
begin
  if TG_OP = 'DELETE' then
    insert into "Cores".audit_log (table_name, record_id, action, old_data)
    values (TG_TABLE_NAME, OLD.id::text, TG_OP, to_jsonb(OLD));
    return OLD;
  elsif TG_OP = 'UPDATE' then
    insert into "Cores".audit_log (table_name, record_id, action, old_data, new_data)
    values (TG_TABLE_NAME, NEW.id::text, TG_OP, to_jsonb(OLD), to_jsonb(NEW));
    return NEW;
  else
    insert into "Cores".audit_log (table_name, record_id, action, new_data)
    values (TG_TABLE_NAME, NEW.id::text, TG_OP, to_jsonb(NEW));
    return NEW;
  end if;
end;
$$;

create trigger audit_trg after insert or update or delete on "Cores".employees
  for each row execute function "Cores".audit_trigger_fn();
create trigger audit_trg after insert or update or delete on "Cores".customers
  for each row execute function "Cores".audit_trigger_fn();
create trigger audit_trg after insert or update or delete on "Cores".vessels
  for each row execute function "Cores".audit_trigger_fn();
create trigger audit_trg after insert or update or delete on "Cores".jobs
  for each row execute function "Cores".audit_trigger_fn();
create trigger audit_trg after insert or update or delete on "Cores".job_tasks
  for each row execute function "Cores".audit_trigger_fn();
create trigger audit_trg after insert or update or delete on "Cores".timesheet_entries
  for each row execute function "Cores".audit_trigger_fn();
create trigger audit_trg after insert or update or delete on "Cores".payroll_config
  for each row execute function "Cores".audit_trigger_fn();
create trigger audit_trg after insert or update or delete on "Cores".stat_holidays
  for each row execute function "Cores".audit_trigger_fn();
create trigger audit_trg after insert or update or delete on "Cores".job_status_logs
  for each row execute function "Cores".audit_trigger_fn();
create trigger audit_trg after insert or update or delete on "Cores".vessel_contacts
  for each row execute function "Cores".audit_trigger_fn();
create trigger audit_trg after insert or update or delete on "Cores".sms_submissions
  for each row execute function "Cores".audit_trigger_fn();
create trigger audit_trg after insert or update or delete on "Cores".job_supplies
  for each row execute function "Cores".audit_trigger_fn();
