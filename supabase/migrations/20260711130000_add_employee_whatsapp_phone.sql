-- Overseas techs (the exact people WhatsApp exists for) almost always have a different
-- SIM/WhatsApp number than their domestic cell -- phone-based employee matching only
-- checked `phone`, so any WhatsApp message from that separate number came back
-- "employee not identified" even for a real, known tech. Adds a second, optional number.

alter table "Cores".employees
  add column whatsapp_phone text;
