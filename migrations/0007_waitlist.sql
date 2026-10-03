-- Pre-sign-ups from the landing page. Plastic is invite-only: an account can be created only for
-- an email an admin has invited (invited_at set), or for an admin (ADMIN_EMAILS).
create table waitlist (
  email text not null primary key,        -- lowercase
  name text,
  role text,
  team_size text,
  use_case text,
  source text not null default 'home',    -- which page the request came from
  created_at integer not null,
  invited_at integer,
  invited_by text
);
create index waitlist_created_idx on waitlist (created_at desc);
