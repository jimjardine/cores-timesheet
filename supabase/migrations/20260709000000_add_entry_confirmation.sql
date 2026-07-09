alter table "Cores"."timesheet_entries"
  add column entry_source text not null default 'sms',
  add column confirmation_status text not null default 'not_required',
  add column confirmation_requested_at timestamptz,
  add column confirmed_at timestamptz,
  add column confirmation_reply_text text;

alter table "Cores"."timesheet_entries"
  add constraint timesheet_entries_confirmation_status_check
  check (confirmation_status in ('not_required', 'pending', 'confirmed'));
