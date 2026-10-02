-- Each project's file list with a version per file (the R2 etag), so listing and opening a
-- project read one D1 row instead of listing R2, and file URLs can be cached by version.
alter table "project" add column "files" text not null default '{}';
