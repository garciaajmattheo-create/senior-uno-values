-- OPTIONAL: hourly "voting closes within 24 hours" reminders.
-- 1. Supabase → Database → Extensions → enable "pg_cron".
-- 2. Run this in the SQL Editor.
select cron.schedule(
  'senior-uno-deadline-reminders',
  '0 * * * *',
  $$ select private.send_deadline_reminders(); $$
);
