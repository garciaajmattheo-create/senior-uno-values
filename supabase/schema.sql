-- =====================================================================
--  SENIOR UNO VALUES — Conduct Award Rating System
--  Nasugbu Senior High School 1
--  Supabase database: tables, security rules and functions.
--  Run this whole file once in Supabase → SQL Editor → New query → Run.
-- =====================================================================

create extension if not exists pgcrypto;
create schema if not exists private;

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('teacher', 'admin');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.account_status as enum ('pending', 'approved', 'declined');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.mark as enum ('AO', 'SO', 'RO', 'NO');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  email       text,
  role        public.user_role not null default 'teacher',
  status      public.account_status not null default 'pending',
  email_notifications boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.school_years (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,              -- e.g. 2026–2027
  is_active  boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists one_active_year on public.school_years (is_active) where is_active;

create table if not exists public.terms (
  id              uuid primary key default gen_random_uuid(),
  school_year_id  uuid not null references public.school_years(id) on delete cascade,
  term_no         smallint not null check (term_no between 1 and 3),
  is_active       boolean not null default false,
  unique (school_year_id, term_no)
);
create unique index if not exists one_active_term on public.terms (is_active) where is_active;

create table if not exists public.sections (
  id              uuid primary key default gen_random_uuid(),
  school_year_id  uuid not null references public.school_years(id) on delete cascade,
  name            text not null,                -- e.g. STEM 12 – Newton
  grade_level     text,
  strand          text,
  adviser_id      uuid not null references public.profiles(id),
  created_at      timestamptz not null default now(),
  unique (school_year_id, name)
);

create table if not exists public.students (
  id          uuid primary key default gen_random_uuid(),
  section_id  uuid not null references public.sections(id) on delete cascade,
  lrn         text,
  last_name   text not null,
  first_name  text not null,
  middle_name text,
  sex         text check (sex in ('M', 'F')),
  created_at  timestamptz not null default now()
);
create index if not exists students_section on public.students (section_id);

-- One row per section per term: its access code and voting state.
create table if not exists public.section_terms (
  id               uuid primary key default gen_random_uuid(),
  section_id       uuid not null references public.sections(id) on delete cascade,
  term_id          uuid not null references public.terms(id) on delete cascade,
  access_code      text not null unique,
  code_updated_at  timestamptz not null default now(),
  voting_open      boolean not null default false,
  closes_at        timestamptz,
  reminder_sent    boolean not null default false,
  unique (section_id, term_id)
);

-- A teacher who entered the section's code for that term.
create table if not exists public.section_links (
  section_term_id  uuid not null references public.section_terms(id) on delete cascade,
  teacher_id       uuid not null references public.profiles(id) on delete cascade,
  linked_at        timestamptz not null default now(),
  is_active        boolean not null default true,   -- false after the adviser changes the code
  primary key (section_term_id, teacher_id)
);
alter table public.section_links add column if not exists is_active boolean not null default true;

-- Individual marks. Only the teacher who gave a mark can ever read it.
create table if not exists public.ratings (
  section_term_id  uuid not null references public.section_terms(id) on delete cascade,
  student_id       uuid not null references public.students(id) on delete cascade,
  teacher_id       uuid not null references public.profiles(id) on delete cascade,
  core_value       smallint not null check (core_value between 1 and 4),
  mark             public.mark not null,
  updated_at       timestamptz not null default now(),
  primary key (section_term_id, student_id, teacher_id, core_value)
);

create table if not exists public.submissions (
  section_term_id  uuid not null references public.section_terms(id) on delete cascade,
  teacher_id       uuid not null references public.profiles(id) on delete cascade,
  submitted_at     timestamptz not null default now(),
  primary key (section_term_id, teacher_id)
);

-- Touched whenever ratings change, so screens can refresh live
-- without anyone seeing the individual marks.
create table if not exists public.section_term_activity (
  section_term_id  uuid primary key references public.section_terms(id) on delete cascade,
  changed_at       timestamptz not null default now()
);

create table if not exists public.tiebreaks (
  id                  uuid primary key default gen_random_uuid(),
  section_id          uuid not null references public.sections(id) on delete cascade,
  candidate_ids       uuid[] not null,
  status              text not null default 'open' check (status in ('open', 'closed')),
  winner_id           uuid references public.students(id),
  decided_by_adviser  boolean not null default false,
  created_at          timestamptz not null default now(),
  closed_at           timestamptz
);
create unique index if not exists one_open_tiebreak on public.tiebreaks (section_id) where status = 'open';

create table if not exists public.tiebreak_votes (
  tiebreak_id  uuid not null references public.tiebreaks(id) on delete cascade,
  teacher_id   uuid not null references public.profiles(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  voted_at     timestamptz not null default now(),
  primary key (tiebreak_id, teacher_id)
);

create table if not exists public.notifications (
  id          bigserial primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  link        text,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user on public.notifications (user_id, created_at desc);

create table if not exists public.push_subscriptions (
  id          bigserial primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Helper functions (private schema = not callable from the website)
-- ---------------------------------------------------------------------
create or replace function private.points(m public.mark) returns numeric
language sql immutable as $$
  select case m when 'AO' then 4 when 'SO' then 3 when 'RO' then 2 else 1 end::numeric
$$;

-- Official mark for an average: 3.50+ AO, 2.50+ SO, 1.50+ RO, below NO.
create or replace function public.letter_of(x numeric) returns text
language sql immutable as $$
  select case when x is null then null
              when x >= 3.5 then 'AO' when x >= 2.5 then 'SO'
              when x >= 1.5 then 'RO' else 'NO' end
$$;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and status = 'approved')
$$;

create or replace function private.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'approved')
$$;

create or replace function private.require_approved() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please log in first.'; end if;
  if not private.is_approved() then raise exception 'Your account is still waiting for the principal''s approval.'; end if;
end $$;

create or replace function private.is_adviser(p_section uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from sections where id = p_section and adviser_id = auth.uid())
$$;

-- Can the current user see this section (adviser, admin, or teacher linked in any term)?
create or replace function private.can_view_section(p_section uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select private.is_admin() or private.is_adviser(p_section) or exists (
    select 1 from section_links l join section_terms st on st.id = l.section_term_id
    where st.section_id = p_section and l.teacher_id = auth.uid())
$$;

create or replace function private.can_view_section_term(p_st uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select private.is_admin()
      or exists (select 1 from section_terms st join sections s on s.id = st.section_id
                 where st.id = p_st and s.adviser_id = auth.uid())
      or exists (select 1 from section_links where section_term_id = p_st and teacher_id = auth.uid() and is_active)
$$;

create or replace function private.active_term() returns uuid
language sql stable security definer set search_path = public as $$
  select id from terms where is_active limit 1
$$;

create or replace function private.notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into notifications (user_id, kind, title, body, link) values (p_user, p_kind, p_title, p_body, p_link)
$$;

-- Access codes look like K7P-4QX (no 0/O/1/I/L to avoid confusion).
create or replace function private.new_code() returns text
language plpgsql volatile security definer set search_path = public as $$
declare chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; c text; i int;
begin
  loop
    c := '';
    for i in 1..6 loop c := c || substr(chars, 1 + floor(random() * length(chars))::int, 1); end loop;
    c := substr(c, 1, 3) || '-' || substr(c, 4, 3);
    exit when not exists (select 1 from section_terms where access_code = c);
  end loop;
  return c;
end $$;

-- Term results without permission checks (used inside other functions).
-- Per core value: adviser's mark = 30%, average of the other teachers = 70%.
-- If only one side has rated yet, that side counts fully.
create or replace function private.st_results(p_st uuid)
returns table (student_id uuid, cv1 numeric, cv2 numeric, cv3 numeric, cv4 numeric, overall numeric, raters int)
language sql stable security definer set search_path = public as $$
  with st as (
    select st.id, st.section_id, s.adviser_id from section_terms st join sections s on s.id = st.section_id where st.id = p_st
  ), per_cv as (
    select r.student_id, r.core_value,
           avg(private.points(r.mark)) filter (where r.teacher_id = st.adviser_id)  as adv,
           avg(private.points(r.mark)) filter (where r.teacher_id <> st.adviser_id) as oth
    from ratings r join st on st.id = r.section_term_id
    group by r.student_id, r.core_value
  ), cv as (
    select student_id, core_value,
           case when adv is not null and oth is not null then 0.3 * adv + 0.7 * oth else coalesce(adv, oth) end as v
    from per_cv
  )
  select stu.id,
         max(cv.v) filter (where cv.core_value = 1),
         max(cv.v) filter (where cv.core_value = 2),
         max(cv.v) filter (where cv.core_value = 3),
         max(cv.v) filter (where cv.core_value = 4),
         avg(cv.v),
         (select count(distinct r.teacher_id)::int from ratings r where r.section_term_id = p_st and r.student_id = stu.id)
  from st join students stu on stu.section_id = st.section_id
  left join cv on cv.student_id = stu.id
  group by stu.id
$$;

-- Final standings: average of the term marks that exist (Terms 1–3).
create or replace function private.final_results(p_section uuid)
returns table (student_id uuid, t1 numeric, t2 numeric, t3 numeric, final numeric)
language sql stable security definer set search_path = public as $$
  with sts as (
    select st.id, t.term_no from section_terms st join terms t on t.id = st.term_id where st.section_id = p_section
  ), per_term as (
    select sts.term_no, r.student_id, r.overall from sts cross join lateral private.st_results(sts.id) r
  )
  select stu.id,
         max(pt.overall) filter (where pt.term_no = 1),
         max(pt.overall) filter (where pt.term_no = 2),
         max(pt.overall) filter (where pt.term_no = 3),
         avg(pt.overall)
  from students stu left join per_term pt on pt.student_id = stu.id
  where stu.section_id = p_section
  group by stu.id
$$;

-- ---------------------------------------------------------------------
-- New sign-ups get a pending teacher profile
-- ---------------------------------------------------------------------
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, email)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)), new.email)
  on conflict (id) do nothing;
  -- Let every admin know someone is waiting.
  insert into notifications (user_id, kind, title, body, link)
  select p.id, 'approval', 'New teacher sign-up',
         coalesce(new.raw_user_meta_data->>'full_name', new.email) || ' is waiting for approval.', '#/admin'
  from profiles p where p.role = 'admin' and p.status = 'approved';
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Ratings changes bump the activity row (drives live refresh).
create or replace function private.touch_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_st uuid := coalesce(new.section_term_id, old.section_term_id);
begin
  insert into section_term_activity (section_term_id, changed_at) values (v_st, now())
  on conflict (section_term_id) do update set changed_at = now();
  return null;
end $$;

drop trigger if exists ratings_touch on public.ratings;
create trigger ratings_touch after insert or update or delete on public.ratings
  for each row execute function private.touch_activity();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles              enable row level security;
alter table public.school_years          enable row level security;
alter table public.terms                 enable row level security;
alter table public.sections              enable row level security;
alter table public.students              enable row level security;
alter table public.section_terms         enable row level security;
alter table public.section_links         enable row level security;
alter table public.ratings               enable row level security;
alter table public.submissions           enable row level security;
alter table public.section_term_activity enable row level security;
alter table public.tiebreaks             enable row level security;
alter table public.tiebreak_votes        enable row level security;
alter table public.notifications         enable row level security;
alter table public.push_subscriptions    enable row level security;

drop policy if exists "own or admin" on public.profiles;
create policy "own or admin" on public.profiles for select using (id = auth.uid() or private.is_admin());

drop policy if exists "read years" on public.school_years;
create policy "read years" on public.school_years for select to authenticated using (true);
drop policy if exists "read terms" on public.terms;
create policy "read terms" on public.terms for select to authenticated using (true);

drop policy if exists "view sections" on public.sections;
create policy "view sections" on public.sections for select using (private.can_view_section(id));
drop policy if exists "adviser edits section" on public.sections;
create policy "adviser edits section" on public.sections for update
  using (adviser_id = auth.uid() or private.is_admin()) with check (adviser_id = auth.uid() or private.is_admin());
drop policy if exists "admin deletes section" on public.sections;
create policy "admin deletes section" on public.sections for delete using (private.is_admin());

drop policy if exists "view students" on public.students;
create policy "view students" on public.students for select using (private.can_view_section(section_id));
drop policy if exists "adviser adds students" on public.students;
create policy "adviser adds students" on public.students for insert
  with check (private.is_approved() and (private.is_adviser(section_id) or private.is_admin()));
drop policy if exists "adviser edits students" on public.students;
create policy "adviser edits students" on public.students for update
  using (private.is_adviser(section_id) or private.is_admin()) with check (private.is_adviser(section_id) or private.is_admin());
drop policy if exists "adviser removes students" on public.students;
create policy "adviser removes students" on public.students for delete
  using (private.is_adviser(section_id) or private.is_admin());

drop policy if exists "view section terms" on public.section_terms;
create policy "view section terms" on public.section_terms for select using (private.can_view_section(section_id));

drop policy if exists "view links" on public.section_links;
create policy "view links" on public.section_links for select using (
  teacher_id = auth.uid() or private.is_admin()
  or exists (select 1 from section_terms st where st.id = section_term_id and private.is_adviser(st.section_id)));

drop policy if exists "own ratings only" on public.ratings;
create policy "own ratings only" on public.ratings for select using (teacher_id = auth.uid());

drop policy if exists "view submissions" on public.submissions;
create policy "view submissions" on public.submissions for select using (
  teacher_id = auth.uid() or private.is_admin()
  or exists (select 1 from section_terms st where st.id = section_term_id and private.is_adviser(st.section_id)));

drop policy if exists "view activity" on public.section_term_activity;
create policy "view activity" on public.section_term_activity for select using (private.can_view_section_term(section_term_id));

drop policy if exists "view tiebreaks" on public.tiebreaks;
create policy "view tiebreaks" on public.tiebreaks for select using (private.can_view_section(section_id));

drop policy if exists "own tiebreak vote" on public.tiebreak_votes;
create policy "own tiebreak vote" on public.tiebreak_votes for select using (teacher_id = auth.uid());

drop policy if exists "own notifications" on public.notifications;
create policy "own notifications" on public.notifications for select using (user_id = auth.uid());
drop policy if exists "mark own read" on public.notifications;
create policy "mark own read" on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "delete own notifications" on public.notifications;
create policy "delete own notifications" on public.notifications for delete using (user_id = auth.uid());

drop policy if exists "own push" on public.push_subscriptions;
create policy "own push" on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Functions the website calls (RPC)
-- ---------------------------------------------------------------------

-- Public: the active school year/term (shown on the landing page).
create or replace function public.public_info() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'year', (select name from school_years where is_active),
    'term', (select term_no from terms where is_active))
$$;

-- Basic info about me + the active school year/term.
create or replace function public.whoami() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', p.id, 'full_name', p.full_name, 'email', p.email, 'role', p.role, 'status', p.status,
    'email_notifications', p.email_notifications,
    'year', (select json_build_object('id', y.id, 'name', y.name) from school_years y where y.is_active),
    'term', (select json_build_object('id', t.id, 'term_no', t.term_no) from terms t where t.is_active),
    'my_section', (select json_build_object('id', s.id, 'name', s.name)
                   from sections s join school_years y on y.id = s.school_year_id and y.is_active
                   where s.adviser_id = p.id limit 1),
    'unread', (select count(*) from notifications n where n.user_id = p.id and not n.is_read))
  from profiles p where p.id = auth.uid()
$$;

create or replace function public.update_my_profile(p_full_name text, p_email_notifications boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please log in first.'; end if;
  update profiles set full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
                      email_notifications = coalesce(p_email_notifications, email_notifications)
  where id = auth.uid();
end $$;

-- Adviser creates their advisory section for the active school year.
create or replace function public.create_my_section(p_name text, p_grade text, p_strand text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_year uuid; v_id uuid;
begin
  perform private.require_approved();
  select id into v_year from school_years where is_active;
  if v_year is null then raise exception 'The principal has not started a school year yet.'; end if;
  if exists (select 1 from sections where school_year_id = v_year and adviser_id = auth.uid()) then
    raise exception 'You already have an advisory section this school year.';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Please enter the section name.'; end if;
  insert into sections (school_year_id, name, grade_level, strand, adviser_id)
  values (v_year, trim(p_name), nullif(trim(p_grade), ''), nullif(trim(p_strand), ''), auth.uid())
  returning id into v_id;
  perform public.ensure_section_term(v_id);
  return v_id;
exception when unique_violation then
  raise exception 'A section with that name already exists this school year.';
end $$;

-- Make sure the section has a row (and code) for the active term.
create or replace function public.ensure_section_term(p_section uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_term uuid := private.active_term(); v_st uuid;
begin
  perform private.require_approved();
  if not (private.is_adviser(p_section) or private.is_admin()) then raise exception 'Only the class adviser can do this.'; end if;
  if v_term is null then raise exception 'There is no active term yet.'; end if;
  select id into v_st from section_terms where section_id = p_section and term_id = v_term;
  if v_st is null then
    insert into section_terms (section_id, term_id, access_code) values (p_section, v_term, private.new_code())
    returning id into v_st;
  end if;
  return v_st;
end $$;

-- Adviser dashboard data for one section.
create or replace function public.advisory_overview(p_section uuid) returns json
language plpgsql security definer set search_path = public as $$
declare v_st uuid; r json;
begin
  perform private.require_approved();
  if not (private.is_adviser(p_section) or private.is_admin()) then raise exception 'Only the class adviser can see this.'; end if;
  if private.active_term() is not null then v_st := public.ensure_section_term(p_section); end if;
  select json_build_object(
    'section', (select json_build_object('id', s.id, 'name', s.name, 'grade_level', s.grade_level, 'strand', s.strand,
                                         'adviser_id', s.adviser_id, 'adviser_name', p.full_name)
                from sections s join profiles p on p.id = s.adviser_id where s.id = p_section),
    'section_term', (select json_build_object('id', st.id, 'access_code', st.access_code, 'code_updated_at', st.code_updated_at,
                                              'voting_open', st.voting_open, 'closes_at', st.closes_at, 'term_no', t.term_no)
                     from section_terms st join terms t on t.id = st.term_id where st.id = v_st),
    'student_count', (select count(*) from students where section_id = p_section),
    'teachers', coalesce((
      select json_agg(json_build_object(
               'id', p.id, 'name', p.full_name, 'is_adviser', p.id = s.adviser_id,
               'active', p.id = s.adviser_id or exists (select 1 from section_links l where l.section_term_id = v_st and l.teacher_id = p.id and l.is_active),
               'rated', (select count(*) from (select r.student_id from ratings r where r.section_term_id = v_st and r.teacher_id = p.id
                                               group by r.student_id having count(*) = 4) x),
               'submitted', exists (select 1 from submissions sb where sb.section_term_id = v_st and sb.teacher_id = p.id))
             order by (p.id = s.adviser_id) desc, p.full_name)
      from sections s
      join profiles p on p.id = s.adviser_id or p.id in (select teacher_id from section_links where section_term_id = v_st)
      where s.id = p_section), '[]'::json),
    'tiebreak', (select json_build_object('id', tb.id, 'status', tb.status) from tiebreaks tb
                 where tb.section_id = p_section order by tb.created_at desc limit 1)
  ) into r;
  return r;
end $$;

-- Teacher enters an access code to link a section for the active term.
create or replace function public.link_section(p_code text) returns json
language plpgsql security definer set search_path = public as $$
declare v_code text; v_st record;
begin
  perform private.require_approved();
  v_code := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(v_code) <> 6 then raise exception 'Access codes have 6 characters, like K7P-4QX.'; end if;
  v_code := substr(v_code, 1, 3) || '-' || substr(v_code, 4, 3);
  select st.id, st.section_id, s.name, s.adviser_id into v_st
  from section_terms st join terms t on t.id = st.term_id and t.is_active
  join sections s on s.id = st.section_id
  where st.access_code = v_code;
  if v_st.id is null then raise exception 'That code is not valid for this term. Ask the adviser for the current code.'; end if;
  if v_st.adviser_id <> auth.uid() then
    insert into section_links (section_term_id, teacher_id) values (v_st.id, auth.uid())
    on conflict (section_term_id, teacher_id) do update set is_active = true, linked_at = now();
  end if;
  return json_build_object('section_term_id', v_st.id, 'section_id', v_st.section_id, 'name', v_st.name);
end $$;

-- Adviser replaces the code. Everyone (except the adviser) must enter the new one.
create or replace function public.regenerate_code(p_section uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_st uuid; v_code text; v_name text; t record;
begin
  v_st := public.ensure_section_term(p_section);
  select name into v_name from sections where id = p_section;
  v_code := private.new_code();
  update section_terms set access_code = v_code, code_updated_at = now() where id = v_st;
  for t in update section_links set is_active = false where section_term_id = v_st and is_active returning teacher_id loop
    perform private.notify(t.teacher_id, 'code', 'Access code changed',
      'The access code for ' || v_name || ' was changed. Ask the adviser for the new code to continue. Your saved ratings are kept.', '#/sections');
  end loop;
  return v_code;
end $$;

-- Adviser opens/closes voting for the active term.
create or replace function public.set_voting(p_section uuid, p_open boolean, p_closes_at timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_st uuid; v_name text; v_term int; t record;
begin
  v_st := public.ensure_section_term(p_section);
  select s.name, tm.term_no into v_name, v_term from section_terms st
    join sections s on s.id = st.section_id join terms tm on tm.id = st.term_id where st.id = v_st;
  update section_terms set voting_open = p_open,
         closes_at = case when p_open then p_closes_at else closes_at end,
         reminder_sent = case when p_open then false else reminder_sent end
  where id = v_st;
  if p_open then
    for t in select teacher_id from section_links where section_term_id = v_st and is_active loop
      perform private.notify(t.teacher_id, 'voting', 'Voting is open',
        'You can now rate ' || v_name || ' for Term ' || v_term || '.', '#/rate/' || v_st);
    end loop;
  end if;
end $$;

-- Sections I handle this term (as subject teacher or adviser).
create or replace function public.my_sections() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x order by x.is_adviser desc, x.name), '[]'::json) from (
    select st.id as section_term_id, s.id as section_id, s.name, p.full_name as adviser_name,
           s.adviser_id = auth.uid() as is_adviser,
           (s.adviser_id <> auth.uid() and not exists (select 1 from section_links l2 where l2.section_term_id = st.id
                                                       and l2.teacher_id = auth.uid() and l2.is_active)) as needs_code,
           st.voting_open, st.closes_at,
           (select count(*) from students where section_id = s.id) as total,
           (select count(*) from (select r.student_id from ratings r where r.section_term_id = st.id and r.teacher_id = auth.uid()
                                  group by r.student_id having count(*) = 4) z) as rated,
           exists (select 1 from submissions sb where sb.section_term_id = st.id and sb.teacher_id = auth.uid()) as submitted,
           (select json_build_object('id', tb.id, 'voted', exists (select 1 from tiebreak_votes v where v.tiebreak_id = tb.id and v.teacher_id = auth.uid()))
              from tiebreaks tb where tb.section_id = s.id and tb.status = 'open') as tiebreak
    from section_terms st
    join terms t on t.id = st.term_id and t.is_active
    join sections s on s.id = st.section_id
    join profiles p on p.id = s.adviser_id
    where s.adviser_id = auth.uid()
       or exists (select 1 from section_links l where l.section_term_id = st.id and l.teacher_id = auth.uid())
  ) x
$$;

-- Everything the rating screen needs: students, my own marks, live averages.
create or replace function public.rating_sheet(p_st uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare r json;
begin
  perform private.require_approved();
  if not private.can_view_section_term(p_st) then raise exception 'Enter this section''s access code first.'; end if;
  select json_build_object(
    'section_term', (select json_build_object('id', st.id, 'section_id', s.id, 'name', s.name, 'term_no', t.term_no,
                                              'voting_open', st.voting_open, 'closes_at', st.closes_at,
                                              'is_adviser', s.adviser_id = auth.uid(),
                                              'submitted', exists (select 1 from submissions sb where sb.section_term_id = st.id and sb.teacher_id = auth.uid()))
                     from section_terms st join sections s on s.id = st.section_id join terms t on t.id = st.term_id where st.id = p_st),
    'students', coalesce((
      select json_agg(json_build_object(
        'id', stu.id, 'last_name', stu.last_name, 'first_name', stu.first_name, 'middle_name', stu.middle_name,
        'mine', (select json_object_agg(r.core_value, r.mark) from ratings r
                 where r.section_term_id = p_st and r.student_id = stu.id and r.teacher_id = auth.uid()),
        'cv', json_build_array(res.cv1, res.cv2, res.cv3, res.cv4),
        'overall', res.overall, 'letter', public.letter_of(res.overall), 'raters', res.raters)
        order by stu.last_name, stu.first_name)
      from section_terms st join students stu on stu.section_id = st.section_id
      left join private.st_results(p_st) res on res.student_id = stu.id
      where st.id = p_st), '[]'::json)
  ) into r;
  return r;
end $$;

-- Save one mark (or clear it with p_mark = null).
create or replace function public.save_rating(p_st uuid, p_student uuid, p_core int, p_mark text) returns void
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  perform private.require_approved();
  select st.voting_open, st.section_id, s.adviser_id into v
  from section_terms st join sections s on s.id = st.section_id join terms t on t.id = st.term_id and t.is_active
  where st.id = p_st;
  if v.section_id is null then raise exception 'This term is no longer active.'; end if;
  if not (v.adviser_id = auth.uid() or exists (select 1 from section_links where section_term_id = p_st and teacher_id = auth.uid() and is_active)) then
    raise exception 'Enter this section''s current access code first.';
  end if;
  if not v.voting_open then raise exception 'Voting for this section is closed.'; end if;
  if not exists (select 1 from students where id = p_student and section_id = v.section_id) then raise exception 'Student not found in this section.'; end if;
  if p_core not between 1 and 4 then raise exception 'Invalid core value.'; end if;
  if p_mark is null then
    delete from ratings where section_term_id = p_st and student_id = p_student and teacher_id = auth.uid() and core_value = p_core;
  else
    insert into ratings (section_term_id, student_id, teacher_id, core_value, mark, updated_at)
    values (p_st, p_student, auth.uid(), p_core, p_mark::public.mark, now())
    on conflict (section_term_id, student_id, teacher_id, core_value) do update set mark = excluded.mark, updated_at = now();
  end if;
end $$;

-- Mark my ratings for this section as finished (all students, all 4 values).
create or replace function public.submit_ratings(p_st uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_missing int;
begin
  perform private.require_approved();
  if not private.can_view_section_term(p_st) then raise exception 'Enter this section''s access code first.'; end if;
  select count(*) into v_missing from section_terms st join students stu on stu.section_id = st.section_id
  where st.id = p_st and (select count(*) from ratings r where r.section_term_id = p_st and r.student_id = stu.id and r.teacher_id = auth.uid()) < 4;
  if v_missing > 0 then raise exception '% student(s) still need all four marks.', v_missing; end if;
  insert into submissions (section_term_id, teacher_id) values (p_st, auth.uid())
  on conflict (section_term_id, teacher_id) do update set submitted_at = now();
end $$;

-- Term-by-term standings for a section (adviser, admin, or linked teachers).
create or replace function public.standings(p_section uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare r json;
begin
  perform private.require_approved();
  if not private.can_view_section(p_section) then raise exception 'You cannot view this section.'; end if;
  select coalesce(json_agg(json_build_object(
      'id', stu.id, 'name', stu.last_name || ', ' || stu.first_name,
      't1', f.t1, 't2', f.t2, 't3', f.t3, 'final', f.final, 'letter', public.letter_of(f.final),
      'l1', public.letter_of(f.t1), 'l2', public.letter_of(f.t2), 'l3', public.letter_of(f.t3))
      order by f.final desc nulls last, stu.last_name), '[]'::json)
  into r
  from private.final_results(p_section) f join students stu on stu.id = f.student_id;
  return r;
end $$;

-- Start a tie-break when two or more students share the top final mark.
create or replace function public.start_tiebreak(p_section uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_top numeric; v_ids uuid[]; v_id uuid; v_name text; t record;
begin
  perform private.require_approved();
  if not (private.is_adviser(p_section) or private.is_admin()) then raise exception 'Only the class adviser can start a tie-break.'; end if;
  if exists (select 1 from tiebreaks where section_id = p_section and status = 'open') then raise exception 'A tie-break vote is already open.'; end if;
  select max(round(final, 2)) into v_top from private.final_results(p_section);
  if v_top is null then raise exception 'There are no final marks yet.'; end if;
  select array_agg(student_id) into v_ids from private.final_results(p_section) where round(final, 2) = v_top;
  if coalesce(array_length(v_ids, 1), 0) < 2 then raise exception 'There is no tie at the top.'; end if;
  insert into tiebreaks (section_id, candidate_ids) values (p_section, v_ids) returning id into v_id;
  select name into v_name from sections where id = p_section;
  for t in select distinct l.teacher_id from section_links l join section_terms st on st.id = l.section_term_id
           where st.section_id = p_section loop
    perform private.notify(t.teacher_id, 'tiebreak', 'Tie-break vote', 'Please vote for the Conduct Awardee of ' || v_name || '.', '#/tiebreak/' || p_section);
  end loop;
  return v_id;
end $$;

-- Tie-break details. Vote counts are only shown after it closes (and to the adviser).
create or replace function public.tiebreak_info(p_section uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare tb record; v_show boolean; r json;
begin
  perform private.require_approved();
  if not private.can_view_section(p_section) then raise exception 'You cannot view this section.'; end if;
  select * into tb from tiebreaks where section_id = p_section order by created_at desc limit 1;
  if tb.id is null then return null; end if;
  v_show := tb.status = 'closed' or private.is_adviser(p_section) or private.is_admin();
  select json_build_object(
    'id', tb.id, 'status', tb.status, 'winner_id', tb.winner_id, 'decided_by_adviser', tb.decided_by_adviser,
    'section_name', (select name from sections where id = p_section),
    'is_adviser', private.is_adviser(p_section),
    'my_vote', (select student_id from tiebreak_votes where tiebreak_id = tb.id and teacher_id = auth.uid()),
    'total_votes', (select count(*) from tiebreak_votes where tiebreak_id = tb.id),
    'candidates', (select json_agg(json_build_object(
        'id', stu.id, 'name', stu.last_name || ', ' || stu.first_name, 'final', f.final,
        'votes', case when v_show then (select count(*) from tiebreak_votes v where v.tiebreak_id = tb.id and v.student_id = stu.id) end)
        order by stu.last_name)
      from students stu join private.final_results(p_section) f on f.student_id = stu.id
      where stu.id = any (tb.candidate_ids))
  ) into r;
  return r;
end $$;

create or replace function public.vote_tiebreak(p_tiebreak uuid, p_student uuid) returns void
language plpgsql security definer set search_path = public as $$
declare tb record;
begin
  perform private.require_approved();
  select * into tb from tiebreaks where id = p_tiebreak;
  if tb.id is null or tb.status <> 'open' then raise exception 'This tie-break vote is closed.'; end if;
  if not (private.is_adviser(tb.section_id) or exists (
          select 1 from section_links l join section_terms st on st.id = l.section_term_id
          where st.section_id = tb.section_id and l.teacher_id = auth.uid())) then
    raise exception 'Only teachers of this section can vote.';
  end if;
  if not (p_student = any (tb.candidate_ids)) then raise exception 'That student is not part of the tie-break.'; end if;
  insert into tiebreak_votes (tiebreak_id, teacher_id, student_id) values (p_tiebreak, auth.uid(), p_student)
  on conflict (tiebreak_id, teacher_id) do update set student_id = excluded.student_id, voted_at = now();
end $$;

-- Adviser closes the tie-break. If votes are still tied, p_decide picks the winner.
create or replace function public.close_tiebreak(p_tiebreak uuid, p_decide uuid default null) returns json
language plpgsql security definer set search_path = public as $$
declare tb record; v_max int; v_top uuid[];
begin
  perform private.require_approved();
  select * into tb from tiebreaks where id = p_tiebreak;
  if tb.id is null or tb.status <> 'open' then raise exception 'This tie-break is already closed.'; end if;
  if not (private.is_adviser(tb.section_id) or private.is_admin()) then raise exception 'Only the class adviser can close the vote.'; end if;
  select max(c) into v_max from (select count(*) c from tiebreak_votes where tiebreak_id = tb.id group by student_id) x;
  select array_agg(id) into v_top from (
    select cand.id, (select count(*) from tiebreak_votes v where v.tiebreak_id = tb.id and v.student_id = cand.id) c
    from unnest(tb.candidate_ids) as cand(id)) y
  where c = coalesce(v_max, 0);
  if array_length(v_top, 1) = 1 then
    update tiebreaks set status = 'closed', winner_id = v_top[1], closed_at = now() where id = tb.id;
    return json_build_object('result', 'winner', 'winner_id', v_top[1]);
  end if;
  if p_decide is null then
    return json_build_object('result', 'tied', 'tied_ids', to_json(v_top));
  end if;
  if not (p_decide = any (v_top)) then raise exception 'Pick one of the students who are still tied.'; end if;
  update tiebreaks set status = 'closed', winner_id = p_decide, decided_by_adviser = true, closed_at = now() where id = tb.id;
  return json_build_object('result', 'winner', 'winner_id', p_decide);
end $$;

-- ---------------------------------------------------------------------
-- Principal / coordinator functions
-- ---------------------------------------------------------------------
create or replace function private.require_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not private.is_admin() then raise exception 'Only the principal or coordinator can do this.'; end if;
end $$;

create or replace function public.admin_overview() returns json
language plpgsql stable security definer set search_path = public as $$
declare r json;
begin
  perform private.require_admin();
  select json_build_object(
    'sections', coalesce((select json_agg(x order by x.name) from (
      select s.id, s.name, p.full_name as adviser_name, st.id as section_term_id,
             coalesce(st.voting_open, false) as voting_open,
             (select count(*) from students where section_id = s.id) as students,
             (select count(*) from section_links l where l.section_term_id = st.id and l.is_active) + 1 as teachers,
             (select count(*) from submissions sb where sb.section_term_id = st.id) as submitted,
             (select stu.last_name || ', ' || stu.first_name from private.st_results(st.id) r join students stu on stu.id = r.student_id
               where r.overall is not null order by r.overall desc limit 1) as leader,
             (select public.letter_of(max(r.overall)) from private.st_results(st.id) r) as leader_letter,
             exists (select 1 from tiebreaks tb where tb.section_id = s.id and tb.status = 'open') as tiebreak_open,
             (select stu.last_name || ', ' || stu.first_name from tiebreaks tb join students stu on stu.id = tb.winner_id
               where tb.section_id = s.id and tb.status = 'closed' order by tb.closed_at desc limit 1) as tiebreak_winner
      from sections s join school_years y on y.id = s.school_year_id and y.is_active
      join profiles p on p.id = s.adviser_id
      left join section_terms st on st.section_id = s.id and st.term_id = private.active_term()) x), '[]'::json),
    'pending', coalesce((select json_agg(json_build_object('id', id, 'full_name', full_name, 'email', email, 'created_at', created_at) order by created_at)
                         from profiles where status = 'pending'), '[]'::json),
    'years', coalesce((select json_agg(json_build_object('id', y.id, 'name', y.name, 'is_active', y.is_active,
                         'terms', (select json_agg(json_build_object('id', t.id, 'term_no', t.term_no, 'is_active', t.is_active) order by t.term_no)
                                   from terms t where t.school_year_id = y.id)) order by y.name desc)
                       from school_years y), '[]'::json)
  ) into r;
  return r;
end $$;

create or replace function public.admin_people() returns json
language sql stable security definer set search_path = public as $$
  select case when private.is_admin() then coalesce(json_agg(json_build_object(
    'id', id, 'full_name', full_name, 'email', email, 'role', role, 'status', status, 'created_at', created_at)
    order by status, full_name), '[]'::json) end
  from profiles
$$;

create or replace function public.admin_set_status(p_user uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform private.require_admin();
  update profiles set status = p_status::public.account_status where id = p_user;
  if p_status = 'approved' then
    perform private.notify(p_user, 'approval', 'Account approved', 'Welcome to Senior UNO Values! You can now link your sections.', '#/sections');
  end if;
end $$;

create or replace function public.admin_set_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform private.require_admin();
  if p_user = auth.uid() and p_role <> 'admin' then raise exception 'You cannot remove your own admin access.'; end if;
  update profiles set role = p_role::public.user_role where id = p_user;
end $$;

-- Create a school year with Terms 1–3.
create or replace function public.admin_create_year(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform private.require_admin();
  insert into school_years (name) values (trim(p_name)) returning id into v_id;
  insert into terms (school_year_id, term_no) values (v_id, 1), (v_id, 2), (v_id, 3);
  return v_id;
exception when unique_violation then raise exception 'That school year already exists.';
end $$;

-- Make a term (and its school year) the active one. Teachers must link sections again.
create or replace function public.admin_activate_term(p_term uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_year uuid; v_no int; v_name text; u record;
begin
  perform private.require_admin();
  select t.school_year_id, t.term_no, y.name into v_year, v_no, v_name from terms t join school_years y on y.id = t.school_year_id where t.id = p_term;
  if v_year is null then raise exception 'Term not found.'; end if;
  update terms set is_active = false where is_active and id <> p_term;
  update school_years set is_active = false where is_active and id <> v_year;
  update school_years set is_active = true where id = v_year;
  update terms set is_active = true where id = p_term;
  -- Close voting everywhere in other terms.
  update section_terms set voting_open = false where term_id <> p_term and voting_open;
  for u in select id from profiles where status = 'approved' loop
    perform private.notify(u.id, 'term', 'Term ' || v_no || ' has started',
      'S.Y. ' || v_name || ' Term ' || v_no || ' is now active. Enter each section''s new access code to rate.', '#/sections');
  end loop;
end $$;

-- Reminder for sections closing within 24 hours (run hourly by pg_cron, optional).
create or replace function private.send_deadline_reminders() returns void
language plpgsql security definer set search_path = public as $$
declare rec record; who record;
begin
  for rec in select x.id, s.name, s.adviser_id from section_terms x join sections s on s.id = x.section_id
             where x.voting_open and not x.reminder_sent and x.closes_at is not null
               and x.closes_at between now() and now() + interval '24 hours' loop
    for who in select l.teacher_id as uid from section_links l where l.section_term_id = rec.id and l.is_active
               union select rec.adviser_id loop
      if not exists (select 1 from submissions sb where sb.section_term_id = rec.id and sb.teacher_id = who.uid) then
        perform private.notify(who.uid, 'deadline', 'Voting closes soon', 'Voting for ' || rec.name || ' closes within 24 hours.', '#/rate/' || rec.id);
      end if;
    end loop;
    update section_terms set reminder_sent = true where id = rec.id;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Permissions for the website's roles
-- ---------------------------------------------------------------------
-- The private schema is never exposed through the website's API, but the
-- security rules above call its helper functions, so logged-in users (and the
-- sign-up trigger) need to be able to use it.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant usage on schema private to authenticated';
    execute 'revoke execute on all functions in schema public from public';
    execute 'revoke execute on all functions in schema public from anon';
    execute 'grant execute on all functions in schema public to authenticated';
    execute 'grant execute on function public.letter_of(numeric) to anon';
    execute 'grant execute on function public.public_info() to anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant usage on schema private to supabase_auth_admin';
    execute 'grant execute on function private.handle_new_user() to supabase_auth_admin';
  end if;
end $$;

-- Live updates (Supabase Realtime)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin execute 'alter publication supabase_realtime add table public.notifications'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.section_term_activity'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.tiebreaks'; exception when duplicate_object then null; end;
  end if;
end $$;
