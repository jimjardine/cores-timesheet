-- audit_log already has table grants (schema-wide ALTER DEFAULT PRIVILEGES) but RLS
-- with zero policies default-denies everything. Add read-only access so the app can
-- show it — no write policy, so only the security-definer trigger function can ever
-- add to it; the app/anon still cannot tamper with history.
create policy "audit_log_select" on "Cores".audit_log for select using (true);
