-- A random identity disambiguates public previews without exposing account IDs or design files.
alter table project add column preview_id text;
create unique index project_preview_id_idx on project (preview_id);
