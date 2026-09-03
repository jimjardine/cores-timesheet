-- Hardens employee-auth login: rate-limits OTP guessing on set_pin (previously
-- unthrottled — only `login`'s PIN check had a lockout), fixes the PIN
-- fail-counter's read-then-write race so concurrent guesses can't dodge the
-- lockout, and adds an IP-based circuit breaker so an attack pattern (many
-- failures across possibly many employees, from one source) gets shut down
-- and Jim gets alerted, even though each individual employee's own lockout
-- is deliberately short and forgiving (the crew isn't tech-savvy and can't
-- be held out of the app over a mistyped PIN).

-- ── set_pin OTP guessing needs its own fail counter/lockout, same shape as
-- the PIN one login already has ──
ALTER TABLE "Cores".employee_auth ADD COLUMN otp_fail_count integer NOT NULL DEFAULT 0;
ALTER TABLE "Cores".employee_auth ADD COLUMN otp_locked_until timestamptz;

-- ── Atomic PIN-failure recorder — replaces the app's old select-then-compute-
-- then-update, which let concurrent requests read the same starting count and
-- clobber each other's increment. The row lock UPDATE takes here forces
-- concurrent calls for the same employee to serialize instead of racing.
-- Mirrors the existing behavior exactly: fail_count resets to 0 the moment a
-- lockout is set, so the count starts fresh once the lockout expires. ──
CREATE OR REPLACE FUNCTION "Cores".record_pin_failure(p_employee_id uuid, p_max_attempts integer, p_lockout_minutes integer)
RETURNS TABLE(new_fail_count integer, new_locked_until timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'Cores', 'pg_catalog'
AS $$
DECLARE
  v_count integer;
  v_locked timestamptz;
BEGIN
  UPDATE "Cores".employee_auth
  SET pin_fail_count = pin_fail_count + 1
  WHERE employee_id = p_employee_id
  RETURNING pin_fail_count INTO v_count;

  IF v_count >= p_max_attempts THEN
    v_locked := now() + (p_lockout_minutes || ' minutes')::interval;
    UPDATE "Cores".employee_auth SET pin_fail_count = 0, pin_locked_until = v_locked, updated_at = now() WHERE employee_id = p_employee_id;
    v_count := 0;
  ELSE
    UPDATE "Cores".employee_auth SET updated_at = now() WHERE employee_id = p_employee_id;
  END IF;

  RETURN QUERY SELECT v_count, v_locked;
END;
$$;

-- Same shape, for the new otp_fail_count/otp_locked_until pair.
CREATE OR REPLACE FUNCTION "Cores".record_otp_failure(p_employee_id uuid, p_max_attempts integer, p_lockout_minutes integer)
RETURNS TABLE(new_fail_count integer, new_locked_until timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'Cores', 'pg_catalog'
AS $$
DECLARE
  v_count integer;
  v_locked timestamptz;
BEGIN
  UPDATE "Cores".employee_auth
  SET otp_fail_count = otp_fail_count + 1
  WHERE employee_id = p_employee_id
  RETURNING otp_fail_count INTO v_count;

  IF v_count >= p_max_attempts THEN
    v_locked := now() + (p_lockout_minutes || ' minutes')::interval;
    UPDATE "Cores".employee_auth SET otp_fail_count = 0, otp_locked_until = v_locked, updated_at = now() WHERE employee_id = p_employee_id;
    v_count := 0;
  ELSE
    UPDATE "Cores".employee_auth SET updated_at = now() WHERE employee_id = p_employee_id;
  END IF;

  RETURN QUERY SELECT v_count, v_locked;
END;
$$;

-- ── IP-based circuit breaker — catches attack-shaped traffic that the
-- per-employee lockouts above don't: an attacker spreading guesses across
-- many employees, or just hammering the endpoint at volume. Separate from
-- and in addition to the per-employee lockouts, not a replacement for them.
-- Locked down the same way employee_auth is (no anon/authenticated grant) —
-- only this function's service-role client touches it. ──
CREATE TABLE "Cores".auth_ip_throttle (
  ip text PRIMARY KEY,
  fail_count integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "Cores".auth_ip_throttle ENABLE ROW LEVEL SECURITY;
-- No GRANT to anon/authenticated and no policies — service_role bypasses RLS,
-- same posture as employee_auth itself.

-- Atomically rolls the failure into the current window (or starts a fresh one
-- if the window's expired), applies the block if the threshold's crossed, and
-- reports back whether this call is what caused a *new* block — the app uses
-- that to only text Jim once per attack, not once per blocked request during
-- the whole cooldown. FOR UPDATE serializes concurrent calls for the same IP,
-- the same fix as record_pin_failure/record_otp_failure above.
CREATE OR REPLACE FUNCTION "Cores".record_ip_auth_failure(p_ip text, p_window_minutes integer, p_max_attempts integer, p_lockout_minutes integer)
RETURNS TABLE(new_fail_count integer, new_blocked_until timestamptz, is_new_block boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'Cores', 'pg_catalog'
AS $$
DECLARE
  v_row "Cores".auth_ip_throttle;
  v_count integer;
  v_window_start timestamptz;
  v_blocked timestamptz;
  v_was_blocked boolean;
  v_is_new_block boolean := false;
BEGIN
  INSERT INTO "Cores".auth_ip_throttle (ip, fail_count, window_started_at)
  VALUES (p_ip, 0, now())
  ON CONFLICT (ip) DO NOTHING;

  SELECT * INTO v_row FROM "Cores".auth_ip_throttle WHERE ip = p_ip FOR UPDATE;

  v_was_blocked := v_row.blocked_until IS NOT NULL AND v_row.blocked_until > now();

  IF now() - v_row.window_started_at > (p_window_minutes || ' minutes')::interval THEN
    v_window_start := now();
    v_count := 1;
  ELSE
    v_window_start := v_row.window_started_at;
    v_count := v_row.fail_count + 1;
  END IF;

  IF v_count >= p_max_attempts THEN
    v_blocked := now() + (p_lockout_minutes || ' minutes')::interval;
    v_is_new_block := NOT v_was_blocked;
  ELSE
    v_blocked := v_row.blocked_until;
  END IF;

  UPDATE "Cores".auth_ip_throttle
  SET fail_count = v_count, window_started_at = v_window_start, blocked_until = v_blocked, updated_at = now()
  WHERE ip = p_ip;

  RETURN QUERY SELECT v_count, v_blocked, v_is_new_block;
END;
$$;
