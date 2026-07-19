# WhatsApp Sandbox Keep-Alive

## What this is and why

Twilio's WhatsApp Sandbox session expires after roughly 72 hours of inactivity — once it expires, whoever joined has to manually re-send `join cookies-could` to the sandbox number (`+14155238886`) before it'll work again. While Jim's real WhatsApp Business sender is still pending approval, this keeps his sandbox join alive automatically.

**Important technical constraint:** the `join cookies-could` message must come *from Jim's own WhatsApp account* (+14734146000) *to* the sandbox — that's how Twilio's sandbox opt-in works. The Twilio REST API can only send messages *as* a number Twilio itself owns (the sandbox number, or an approved WhatsApp Business sender) — it can never send *as* an arbitrary personal WhatsApp account. So this can't be done as a pure server-side/Supabase job; it has to drive the real WhatsApp Web client, logged in as Jim.

**Once Jim's real WhatsApp Business number goes live, this should be cancelled** — see "How to turn it off" below.

## How it actually works

A recurring Claude Code cron job (`CronCreate`, job id `25a95e52`, `17 */12 * * *` — every 12 hours) checks a local timestamp file and, once 54+ hours have passed since the last send, drives Chrome via the `claude-in-chrome` browser tools to:

1. Open `https://web.whatsapp.com` (must already be logged in — see below).
2. Open the "Twilio" Business Account chat (the sandbox conversation).
3. Type and send `join cookies-could`.
4. Record the new send time to `~/.cores_whatsapp_keepalive_last_sent`.

**Two important limitations:**

- **This only runs while a specific Claude Code session stays open.** It is NOT a background daemon or a system service — if the terminal/session that created the cron job closes for any reason (quit, crash, reboot), the job disappears immediately, not just after some grace period. It needs to be recreated by asking Claude to set it up again in a new session.
- **Recurring cron jobs auto-expire after 7 days** regardless of whether the session stays open, and need to be re-armed (just ask Claude to redo the `CronCreate` call — same cron expression and prompt as above).

Given both, this is a best-effort mechanism tied to how often this laptop has an active Claude Code session going — which is why the acceptable failure mode here is "you haven't used Claude Code in a while," not a hard guarantee.

## WhatsApp Web login

The automation reuses whatever Chrome profile Claude's browser tools are already connected to. As long as:
- You don't manually unlink the device (phone → WhatsApp → Settings → Linked Devices)
- Chrome's cookies/site data for that profile don't get cleared
- Your phone doesn't go offline for a very long stretch

...the WhatsApp Web session should stay logged in indefinitely without re-scanning a QR code. If the cron job ever reports "WhatsApp Web logged out, needs to be re-scanned," you'll need to scan a fresh QR code with your phone (Settings → Linked Devices → Link a Device) the next time you're in a session with Claude.

## How to check it's working

Ask Claude to run `CronList` to confirm the job is still registered (remember: gone if the session that created it has since closed). You can also check the local state file directly:

```bash
cat ~/.cores_whatsapp_keepalive_last_sent
```

This shows the UTC timestamp of the last confirmed send.

## How to turn it off

Ask Claude to run `CronDelete` on job id `25a95e52` (or whatever the current job id is — ask Claude to look it up via `CronList` if this doc is stale). No code, migration, or secret changes needed — this mechanism lives entirely in the cron scheduler and a local timestamp file.

## How to change the cadence or threshold

Ask Claude to cancel the existing job (`CronDelete`) and recreate it with a new cron expression / elapsed-hours threshold — there's no config file to hand-edit, since the logic lives in the prompt text of the scheduled job itself.

## Superseded approach (disabled, not in use)

An earlier attempt tried to solve this by having the `sms-timesheet` edge function send an automated WhatsApp ping *from* the sandbox *to* Jim every ~72h via `pg_cron` + `pg_net` inside Supabase. This turned out not to solve the actual problem — Twilio's sandbox timeout is based on messages sent *to* the sandbox by the joined user, not messages received from it — so it's been disabled (`update "Cores".whatsapp_keepalive_state set enabled = false;`). The code, migration, secrets, and Vault entries are still in place (harmless, inert) in case a variant of that mechanism is ever useful for something else:

| Piece | Name |
|---|---|
| Edge function | `supabase/functions/sms-timesheet/index.ts` — `sendTwilioWhatsApp()` helper + `action === 'whatsapp_keepalive'` branch |
| Edge Function secrets | `WHATSAPP_KEEPALIVE_SECRET`, `WHATSAPP_KEEPALIVE_TO_PHONE` |
| Vault secrets (Postgres side) | `whatsapp_keepalive_secret`, `whatsapp_keepalive_url` |
| State table | `"Cores".whatsapp_keepalive_state` (single row, `id = true`, currently `enabled = false`) |
| Postgres function | `"Cores".check_whatsapp_keepalive()` |
| Cron job (inert) | `whatsapp-keepalive-check` (`0 */6 * * *`) |
| Migration | `supabase/migrations/20260719120000_whatsapp_keepalive.sql` |
