-- PIN-based login for the employee mobile self-service site (/my). Kept as its
-- own table rather than columns on employees so the hash never rides along on
-- the existing `select('*')` calls against Cores.employees (AdminDashboard etc).
-- Unlike the rest of the app's tables, this one stays closed to anon/authenticated
-- — it's only ever touched by the employee-auth edge function via the service
-- role key, since a leaked PIN hash for a 4-digit PIN is trivially brute-forced.
CREATE TABLE IF NOT EXISTS "Cores".employee_auth (
  employee_id UUID PRIMARY KEY REFERENCES "Cores".employees(id) ON DELETE CASCADE,
  pin_hash TEXT,
  pin_salt TEXT,
  pin_fail_count INTEGER NOT NULL DEFAULT 0,
  pin_locked_until TIMESTAMPTZ,
  otp_code_hash TEXT,
  otp_expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE "Cores".employee_auth ENABLE ROW LEVEL SECURITY;
-- No GRANT to anon/authenticated and no policies — service_role bypasses RLS,
-- so the edge function (which uses the service role key) is the only writer/reader.
