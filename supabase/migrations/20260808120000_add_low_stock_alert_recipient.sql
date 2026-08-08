-- Lets the admin panel control who gets low-stock alert emails, instead of
-- a hardcoded list in the edge function. email already existed on employees
-- but was unused until now.
ALTER TABLE "Cores".employees
  ADD COLUMN IF NOT EXISTS low_stock_alert_recipient BOOLEAN NOT NULL DEFAULT false;
