-- Suspended members. A suspension starts at starts_at (now, or later for a grace period):
-- from then on no sign-in creates a session, and existing sessions are ended (immediately, or
-- by the hourly job for a scheduled start, which then sets signed_out_at).
create table suspension (
  user_id text not null primary key references "user" ("id") on delete cascade,
  starts_at integer not null,
  reason text,
  created_at integer not null,
  created_by text not null,
  signed_out_at integer
);
create index suspension_pending_idx on suspension (signed_out_at, starts_at);
