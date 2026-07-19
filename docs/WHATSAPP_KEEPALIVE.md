# WhatsApp Sandbox Keep-Alive

## What this is and why

Twilio's WhatsApp Sandbox session expires after roughly 72 hours of inactivity between the sandbox number and a joined user — once it expires, the user has to manually re-send `join cookies-could` to the sandbox number before it'll work again. While Jim's real WhatsApp sender is still pending approval, this job automatically texts `join cookies-could` to his WhatsApp number every ~72 hours so that never has to happen manually.

It runs entirely inside Supabase — a `pg_cron` job checks in every 6 hours and, once 66+ hours have passed since the last send, calls the `sms-timesheet` edge function via `pg_net`, which sends the WhatsApp message through Twilio. No Claude session or external scheduler is involved; it'll keep running indefinitely until turned off below.

**Once Jim's real WhatsApp number goes live, turn this off** — see "How to turn it off" below.

## How to change the recipient number

```bash
supabase secrets set WHATSAPP_KEEPALIVE_TO_PHONE=+1XXXXXXXXXX --project-ref wgjuflwbkmgirhqoqfgp
```

Takes effect on the next send automatically — no redeploy, no migration. The number must already be joined to the Twilio Sandbox (i.e. it has sent `join cookies-could` to the sandbox number at least once), or the send will fail.

## How to add/rotate the shared secret

The cron job and the edge function authenticate to each other with a shared secret. **It lives in two places that must match:**

1. Edge Function secret:
   ```bash
   supabase secrets set WHATSAPP_KEEPALIVE_SECRET=<new value> --project-ref wgjuflwbkmgirhqoqfgp
   ```
2. The Vault entry Postgres reads when calling out:
   ```sql
   update vault.secrets
   set secret = '<same new value>'
   where name = 'whatsapp_keepalive_secret';
   ```

If these ever get out of sync, sends will silently fail with a `401 unauthorized` from the edge function — that mismatch is the first thing to check if the keep-alive stops working.

## How to change the cadence or the 66-hour threshold

- **The 66-hour send gate** lives in `"Cores".check_whatsapp_keepalive()` — edit and `create or replace function ...` (either a new migration file, or run it ad hoc via the `execute_sql` MCP tool / Supabase SQL editor).
- **The 6-hour poll interval** lives in the cron schedule:
  ```sql
  select cron.alter_job(
    (select jobid from cron.job where jobname = 'whatsapp-keepalive-check'),
    schedule := '<new 5-field cron expression>'
  );
  ```

## How to turn it off (and back on)

One line, no migration or redeploy needed:

```sql
update "Cores".whatsapp_keepalive_state set enabled = false;
```

The cron job keeps running every 6 hours but no-ops instantly on this check — cheap and self-documenting. To turn it back on later:

```sql
update "Cores".whatsapp_keepalive_state set enabled = true;
```

## How to check it's working

```sql
-- Is the job registered and active?
select jobid, jobname, schedule, active from cron.job where jobname = 'whatsapp-keepalive-check';

-- Current state (enabled? when did it last actually send?)
select * from "Cores".whatsapp_keepalive_state;

-- Did it fire, and on schedule?
select * from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'whatsapp-keepalive-check')
order by start_time desc limit 5;

-- Did the actual HTTP call to the edge function succeed?
select id, status_code, content, created from net._http_response order by created desc limit 5;
```

A healthy run shows `status_code = 200` and `content` containing `{"ok":true}`.

## Where everything lives

| Piece | Name |
|---|---|
| Edge function | `supabase/functions/sms-timesheet/index.ts` — `sendTwilioWhatsApp()` helper + `action === 'whatsapp_keepalive'` branch |
| Edge Function secrets | `WHATSAPP_KEEPALIVE_SECRET`, `WHATSAPP_KEEPALIVE_TO_PHONE` |
| Vault secrets (Postgres side) | `whatsapp_keepalive_secret`, `whatsapp_keepalive_url` |
| State table | `"Cores".whatsapp_keepalive_state` (single row, `id = true`) |
| Postgres function | `"Cores".check_whatsapp_keepalive()` |
| Cron job | `whatsapp-keepalive-check` (`0 */6 * * *`) |
| Migration | `supabase/migrations/20260719120000_whatsapp_keepalive.sql` |
