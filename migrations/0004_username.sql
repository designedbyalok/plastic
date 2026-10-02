-- Better Auth username plugin (generated with its migration compiler for SQLite).
alter table "user" add column "username" text;

alter table "user" add column "displayUsername" text;

create unique index "user_username_uidx" on "user" ("username");
