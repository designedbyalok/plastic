-- Folders, the archive, and daily activity for the profile.
create table "folder" (
  "owner_id" text not null references "user" ("id") on delete cascade,
  "id" text not null,
  "name" text not null,
  "created_at" integer not null,
  primary key ("owner_id", "id")
);

alter table "project" add column "folder_id" text;

alter table "project" add column "archived_at" integer;

-- One row per user per day with activity: a counter, so recording an edit is a single write.
create table "activity" (
  "owner_id" text not null references "user" ("id") on delete cascade,
  "day" text not null,
  "edits" integer not null default 0,
  primary key ("owner_id", "day")
);
