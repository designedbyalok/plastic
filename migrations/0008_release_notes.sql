-- Release-notes email: who opted out (one-click unsubscribe) and who already received which
-- edition, so every member gets each edition once.
create table email_preference (
  email text not null primary key,            -- lowercase
  release_notes_opt_out integer not null default 0,
  updated_at integer not null
);
create table release_note_send (
  email text not null,
  release text not null,                      -- edition id, see worker/releaseNotes.ts
  sent_at integer not null,
  primary key (email, release)
);
