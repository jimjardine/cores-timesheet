-- A tech gets asked a follow-up question (lunch/per diem/supplies) and never answers —
-- the conversation sits in status='collecting' forever and never reaches Nicki's review
-- queue, since 'collecting' rows only ever transition on a NEW inbound message. This adds
-- a scheduled sweep that treats prolonged silence as "no answer" and closes it out with
-- whatever's there, same as the existing "asked once, don't nag" give-up logic already
-- does when a reply DOES come in but doesn't resolve the question.

insert into "Cores".payroll_config (key, value, description)
values ('sms_followup_timeout_hours', 4, 'Hours of silence after an unanswered SMS follow-up question before it auto-closes for review')
on conflict (key) do nothing;

create or replace function "Cores".auto_close_stale_sms_conversations() returns void
language plpgsql security definer set search_path = 'Cores', 'pg_catalog' as $$
declare
  timeout_hours numeric;
begin
  select value into timeout_hours from "Cores".payroll_config where key = 'sms_followup_timeout_hours';
  if timeout_hours is null then timeout_hours := 4; end if;

  update "Cores".sms_submissions
  set status = 'submitted'
  where status = 'collecting'
    and pending_questions is not null
    and jsonb_array_length(pending_questions) > 0
    and updated_at < now() - (timeout_hours || ' hours')::interval;
end;
$$;

create extension if not exists pg_cron with schema extensions;

select cron.schedule(
  'auto-close-stale-sms-conversations',
  '0 * * * *', -- hourly
  $$ select "Cores".auto_close_stale_sms_conversations(); $$
);
