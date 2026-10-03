-- Comments on a file, kept beside it (not in its HTML): a thread is its first comment (id =
-- thread_id), which holds the pin; replies share the thread_id. A pin is anchored to a layer
-- (node_id + offset in CSS px from its top-left) and falls back to its canvas position
-- (world_x/world_y) when that layer is gone.
create table comment (
  id text not null primary key,
  owner_id text not null references "user" ("id") on delete cascade,
  project_id text not null,
  thread_id text not null,
  author_id text not null references "user" ("id") on delete cascade,
  body text not null,
  created_at integer not null,
  edited_at integer,
  page text,
  node_id text,
  x real,
  y real,
  world_x real,
  world_y real,
  resolved_at integer,
  resolved_by text
);
create index comment_project_idx on comment (owner_id, project_id, created_at);
create index comment_thread_idx on comment (thread_id);
