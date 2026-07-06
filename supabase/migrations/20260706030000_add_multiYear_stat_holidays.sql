-- Expand stat holidays to cover 2025-2027
-- Nova Scotia / Canada statutory holidays

-- First, ensure the table exists
CREATE TABLE IF NOT EXISTS "Cores".stat_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date date NOT NULL UNIQUE,
  holiday_name text NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

-- Delete existing data to avoid duplicates (if re-running)
DELETE FROM "Cores".stat_holidays WHERE EXTRACT(YEAR FROM holiday_date) IN (2025, 2026, 2027);

-- 2025 Stat Holidays
INSERT INTO "Cores".stat_holidays (holiday_date, holiday_name) VALUES
('2025-01-01', 'New Year''s Day'),
('2025-02-17', 'Family Day'),
('2025-04-18', 'Good Friday'),
('2025-05-19', 'Victoria Day'),
('2025-07-01', 'Canada Day'),
('2025-09-01', 'Labour Day'),
('2025-09-30', 'National Day for Truth and Reconciliation'),
('2025-10-13', 'Thanksgiving'),
('2025-11-11', 'Remembrance Day'),
('2025-12-25', 'Christmas'),
('2025-12-26', 'Boxing Day');

-- 2026 Stat Holidays
INSERT INTO "Cores".stat_holidays (holiday_date, holiday_name) VALUES
('2026-01-01', 'New Year''s Day'),
('2026-02-16', 'Family Day'),
('2026-04-03', 'Good Friday'),
('2026-05-18', 'Victoria Day'),
('2026-07-01', 'Canada Day'),
('2026-09-07', 'Labour Day'),
('2026-09-30', 'National Day for Truth and Reconciliation'),
('2026-10-12', 'Thanksgiving'),
('2026-11-11', 'Remembrance Day'),
('2026-12-25', 'Christmas'),
('2026-12-26', 'Boxing Day');

-- 2027 Stat Holidays
INSERT INTO "Cores".stat_holidays (holiday_date, holiday_name) VALUES
('2027-01-01', 'New Year''s Day'),
('2027-02-15', 'Family Day'),
('2027-03-26', 'Good Friday'),
('2027-05-17', 'Victoria Day'),
('2027-07-01', 'Canada Day'),
('2027-09-06', 'Labour Day'),
('2027-09-30', 'National Day for Truth and Reconciliation'),
('2027-10-11', 'Thanksgiving'),
('2027-11-11', 'Remembrance Day'),
('2027-12-25', 'Christmas'),
('2027-12-26', 'Boxing Day');
