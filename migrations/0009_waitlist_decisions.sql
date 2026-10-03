-- Admin decisions on the waitlist. A rejected person stays off the list (joining again changes
-- nothing); cancelling an invite clears invited_at, which also voids any invite link sent.
alter table waitlist add column rejected_at integer;
