-- Update Thales jobs from whiteboard
-- Replace all existing jobs and clear timesheets

-- Delete all timesheet entries first
DELETE FROM "Cores".timesheet_entries;

-- Delete all existing jobs
DELETE FROM "Cores".jobs;

-- Delete all existing vessels
DELETE FROM "Cores".vessels;

-- Delete all existing customers (keep only Thales)
DELETE FROM "Cores".customers;

-- Insert Thales customer
INSERT INTO "Cores".customers (name) VALUES ('Thales');
-- Store the customer ID for use in jobs
WITH thales AS (SELECT id FROM "Cores".customers WHERE name = 'Thales')

-- Insert vessels
INSERT INTO "Cores".vessels (name)
SELECT DISTINCT vessel_name FROM (
  VALUES
    ('AQM'),
    ('YellowJfe'),
    ('Naniimo'),
    ('H44'),
    ('Tonnerre'),
    ('Glenside'),
    ('Resolute'),
    ('Fortune'),
    ('Glenbrook'),
    ('VFU137'),
    ('Edmonton'),
    ('Vea')
) AS v(vessel_name);

-- Insert all jobs (Shop section - AQM)
WITH thales AS (SELECT id AS cid FROM "Cores".customers WHERE name = 'Thales'),
     aqm_v AS (SELECT id AS vid FROM "Cores".vessels WHERE name = 'AQM')
INSERT INTO "Cores".jobs (customer_id, vessel_id, job_number, description, status)
SELECT thales.cid, aqm_v.vid, job_num, desc, 'open'
FROM thales, aqm_v, (
  VALUES
    (4760, '13 Air Strts - picked up'),
    (4719, '13 Cyl Liners'),
    (4713, '13 Pistons'),
    (4711, '13 Camods'),
    (4717, '10 Pump-Rev - picked up'),
    (4781, '12 Cylinder Heads - picked up'),
    (4736, 'FW Pump-Rev - picked up'),
    (4786, 'FW Pump-Std - picked up'),
    (4787, 'SW Pump-Rev - picked up'),
    (4788, 'SW Pump-Std - picked up'),
    (4790, 'LO Pump-Std - picked up'),
    (4791, 'FW Pump-Std - picked up'),
    (4803, 'Det FW Pump - need onshore support'),
    (4805, 'Fuel Oil Boost Pump - picked up'),
    (4810, 'Souma Turbo - picked up'),
    (4876, 'Fuel Oil Boost Pump - picked up'),
    (4838, 'GTI Injector - picked up'),
    (4917, 'Qty1 Auxin Fuel Pump')
) AS shop(job_num, desc);

-- Insert all jobs (Dockyard section - various vessels)
WITH thales AS (SELECT id AS cid FROM "Cores".customers WHERE name = 'Thales')
INSERT INTO "Cores".jobs (customer_id, vessel_id, job_number, description, status)
SELECT
  thales.cid,
  v.id,
  j.job_num,
  j.desc,
  CASE WHEN j.desc LIKE '%Done%' THEN 'closed' ELSE 'open' END
FROM thales,
  (VALUES
    ('YellowJfe', 4903, 'Rescue engines - ON HOLD'),
    ('Naniimo', 4825, 'BKD-124: Complete - need to run + paperwork'),
    ('H44', 4846, 'LOM Deck Crane'),
    ('H44', 4847, 'LOM Diesel Gen - have parts'),
    ('Tonnerre', 4869, 'Replace filters and fuel lines - have all parts'),
    ('Glenside', 4879, 'Std SW Pump - have pump - need vessel available to complete'),
    ('Naniimo', 4993, '1300 IAM Emerg'),
    ('Glenbrook', 4994, 'Ballard Pull - complete need paperwork - Done'),
    ('Tonnerre', 4995, 'Port ME Shut off Solenoid'),
    ('Edmonton', 4906, '1300 IAM Eng - to be done by July'),
    ('Resolute', 4907, 'Oil Pressure Gauge'),
    ('Naniimo', 4909, 'BKD IAM Emerg'),
    ('Vea', 4910, 'Port Gen Coolant Pumps - have parts - Done'),
    ('Vea', 4911, 'Std Gen Coolant Pumps - have parts - Done'),
    ('Fortune', 4912, 'Emg Fuel Stops'),
    ('Fortune', 4913, 'Fuel System Labelling'),
    ('Resolute', 4914, 'Flexible Fuel Lines'),
    ('VFU137', 4915, 'Port - 2000 HR - Help ShipStaff finish, paperwork'),
    ('VFU137', 4916, 'Std - 2000 HR - Help ShipStaff finish, paperwork'),
    ('Glenbrook', 4918, 'Cut head change - done need paperwork - Done'),
    ('VFU137', 4922, 'Exhaust Elbow - have parts - Done'),
    ('Edmonton', 4927, 'Pre Deployment Check - Auxi Emiag - Done')
  ) AS j(vessel_name, job_num, desc)
  JOIN "Cores".vessels v ON v.name = j.vessel_name;
