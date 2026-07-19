-- Twilio's WhatsApp Sandbox session expires after ~72h of inactivity between
-- the sandbox number and a joined user, requiring a manual "join <code>"
-- re-send. Jim is waiting on his real WhatsApp sender to be approved — until
-- then, this pings his phone every ~72h to keep the sandbox session alive.
--
-- Standard cron has no native "every 72h" primitive (day-of-month steps drift
-- at month boundaries), so a lightweight checker runs every 6h and only
-- actually sends once 66+ hours have elapsed since the last send — guarantees
-- delivery somewhere in the 66-72h window, safely inside Twilio's cutoff.
--
-- The shared secret + edge function URL live in Supabase Vault (created via
-- `select vault.create_secret(...)` run directly against the DB), never as
-- literal values here, so nothing sensitive is committed to git.

create extension if not exists pg_net with schema extensions;

create table "Cores".whatsapp_keepalive_state (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  last_sent_at timestamptz
);
insert into "Cores".whatsapp_keepalive_state (id) values (true);

create or replace function "Cores".check_whatsapp_keepalive() returns void
language plpgsql security definer set search_path = 'Cores', 'extensions', 'vault', 'pg_catalog' as $$
declare
  st "Cores".whatsapp_keepalive_state;
  v_secret text;
  v_url text;
begin
  select * into st from "Cores".whatsapp_keepalive_state where id = true;
  if not st.enabled then return; end if;
  if st.last_sent_at is not null and st.last_sent_at > now() - interval '66 hours' then return; end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'whatsapp_keepalive_secret';
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'whatsapp_keepalive_url';
  if v_secret is null or v_url is null then return; end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('action', 'whatsapp_keepalive', 'secret', v_secret)
  );

  update "Cores".whatsapp_keepalive_state set last_sent_at = now() where id = true;
end;
$$;

select cron.schedule(
  'whatsapp-keepalive-check',
  '0 */6 * * *', -- every 6 hours; actual send is gated at 66h inside the function
  $$ select "Cores".check_whatsapp_keepalive(); $$
);
