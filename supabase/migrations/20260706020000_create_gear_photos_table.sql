-- Store gear photos texted in from the field
CREATE TABLE IF NOT EXISTS "Cores".gear_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES "Cores".employees(id) ON DELETE SET NULL,
  work_date date NOT NULL,
  from_phone text NOT NULL,
  storage_path text NOT NULL,
  file_size_bytes integer,
  message_text text,
  ship_or_job text,
  pending_context boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT fk_employee FOREIGN KEY (employee_id) REFERENCES "Cores".employees(id) ON DELETE SET NULL
);

CREATE INDEX idx_gear_photos_employee_date ON "Cores".gear_photos(employee_id, work_date);
CREATE INDEX idx_gear_photos_phone_date ON "Cores".gear_photos(from_phone, work_date);
