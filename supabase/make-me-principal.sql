-- Run ONCE after the principal (or coordinator) has signed up on the website.
-- Replace the email below with theirs, then click Run.
update public.profiles
set role = 'admin', status = 'approved'
where email = 'principal@example.com';
