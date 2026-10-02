-- Projects in the cloud: one row per file a user owns. The files themselves (pages, CSS,
-- project.json, assets/) are R2 objects under users/<owner_id>/projects/<id>/.
create table "project" (
  "owner_id" text not null references "user" ("id") on delete cascade,
  "id" text not null,
  "title" text not null,
  "created_at" integer not null,
  "updated_at" integer not null,
  primary key ("owner_id", "id")
);

create index "project_owner_updated_idx" on "project" ("owner_id", "updated_at" desc);
