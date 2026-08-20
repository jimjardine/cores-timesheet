-- Twilio resends an inbound webhook delivery (same MessageSid) if it doesn't
-- get a fast enough response, and the edge function had no way to tell a
-- retry apart from a genuinely new text — every retry got processed as its
-- own message, silently duplicating whatever it reported. Live example:
-- Gage's Aug 20 2026 timesheet — one text landed on our side 3 times ~0.3s
-- apart (tripling reported hours on job 4866) while his own phone only ever
-- showed it sent once, confirming the duplication happened on our side, not
-- his.
--
-- This table lets the edge function atomically claim a MessageSid before
-- doing any real work — a unique-constraint conflict means "already
-- handled," safe even if two retries race each other.
create table "Cores".processed_message_sids (
  message_sid text primary key,
  created_at timestamptz not null default now()
);

-- Internal-only table, same posture as whatsapp_keepalive_state (see
-- 20260813210000_lock_down_whatsapp_keepalive_state.sql) — only the edge
-- function (service_role, bypasses RLS) ever touches this. RLS enabled with
-- no policies and no GRANT to anon/authenticated: default-deny for both.
alter table "Cores".processed_message_sids enable row level security;

-- Prune old rows — a MessageSid only needs to be remembered long enough to
-- catch a retry (Twilio's retry window is minutes, not days); 30 days is
-- generous headroom at negligible storage cost for this message volume.
create or replace function "Cores".prune_processed_message_sids() returns void
language plpgsql security definer set search_path = 'Cores', 'pg_catalog' as $$
begin
  delete from "Cores".processed_message_sids where created_at < now() - interval '30 days';
end;
$$;

create extension if not exists pg_cron with schema extensions;

select cron.schedule(
  'prune-processed-message-sids',
  '0 3 * * *', -- daily at 3am
  $$ select "Cores".prune_processed_message_sids(); $$
);
