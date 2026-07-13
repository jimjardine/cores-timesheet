-- Real FK so job reports can count/link photos, instead of relying on the free-text
-- ship_or_job matching job_number by string comparison at display time.
alter table "Cores".gear_photos
  add column job_id uuid references "Cores".jobs(id) on delete set null;

create index idx_gear_photos_job_id on "Cores".gear_photos(job_id);

update "Cores".gear_photos gp
set job_id = j.id
from "Cores".jobs j
where gp.job_id is null
  and gp.ship_or_job is not null
  and lower(gp.ship_or_job) = lower(j.job_number);
