-- hours was numeric(4,1), silently rounding any quarter-hour entry ("6.25hrs", "7.75hrs")
-- to one decimal on every insert, regardless of what the app sent. The SMS parser and
-- manual entry both explicitly support quarter-hour precision (see SMS_USER_MANUAL.md),
-- so the column needs to actually be able to store it.
alter table "Cores".timesheet_entries
  alter column hours type numeric(6,2);
