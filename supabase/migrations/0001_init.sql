-- JobRadar user-side schema.
--
-- The job corpus itself is NOT here. It stays in the data branch as JSON,
-- rebuilt by the sweep every half hour, because it is public, immutable
-- between sweeps and identical for every visitor. Only per-user data lives in
-- Postgres: who someone is, what they are looking for, their resume, and what
-- we worked out about their fit for a given posting.
--
-- Jobs are therefore referenced by their string id ("ashby-tradeify-abc123")
-- with no foreign key, since the target does not exist in this database. A job
-- ageing out of the archive leaves its match rows behind harmlessly.
--
-- Run this in the Supabase SQL editor, or via `supabase db push`.

-- ---------------------------------------------------------------------------
-- profiles: one row per user, created automatically on signup
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,

  -- What the onboarding questions capture. Arrays rather than a single value
  -- because people look for more than one thing at once, and the whole point
  -- of asking is to curate the board rather than to label the person.
  desired_categories text[] not null default '{}',
  desired_roles      text[] not null default '{}',
  seniority          text,
  desired_locations  text[] not null default '{}',
  open_to_relocation boolean not null default false,

  onboarded_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on column public.profiles.desired_categories is
  'Coarse groups from CATEGORIES in server/src/filter.js: software, product, commercial, business, other.';
comment on column public.profiles.desired_roles is
  'Fine role keys from ROLE_LABELS: backend, product, marketing, and so on.';

-- ---------------------------------------------------------------------------
-- resumes: the uploaded file plus whatever we managed to read out of it
-- ---------------------------------------------------------------------------

create table if not exists public.resumes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,

  -- Path within the private 'resumes' storage bucket, not a public URL. The
  -- file is only ever reachable through a signed URL minted for its owner.
  storage_path text not null,
  filename     text not null,
  byte_size    integer,
  mime_type    text,

  -- Extracted once on upload and reused for every match, so a user with fifty
  -- assessments is still only parsed a single time.
  extracted_text text,

  -- Structured fields pulled from the text: skills, years, titles, education.
  -- jsonb rather than columns because what we can extract varies wildly by CV
  -- and adding a column per field would mean a migration each time.
  parsed jsonb not null default '{}'::jsonb,

  -- Exactly one resume per user is the active one. Enforced by the partial
  -- unique index below rather than by application code, which forgets.
  is_current boolean not null default true,

  created_at timestamptz not null default now()
);

create unique index if not exists resumes_one_current_per_user
  on public.resumes (user_id) where is_current;

create index if not exists resumes_user_idx on public.resumes (user_id);

-- ---------------------------------------------------------------------------
-- job_matches: cached fit assessments
-- ---------------------------------------------------------------------------

create table if not exists public.job_matches (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users (id) on delete cascade,
  resume_id uuid not null references public.resumes (id) on delete cascade,

  -- No FK: the job lives in the data branch, not in Postgres. See the note at
  -- the top of this file.
  job_id     text not null,
  job_title  text,
  job_company text,

  score     integer check (score between 0 and 100),
  verdict   text,
  summary   text,
  strengths jsonb not null default '[]'::jsonb,
  gaps      jsonb not null default '[]'::jsonb,
  advice    jsonb not null default '[]'::jsonb,

  model      text,
  created_at timestamptz not null default now(),

  -- One assessment per resume per job. Re-opening a role you already viewed
  -- costs nothing; uploading a new CV produces a fresh row rather than
  -- overwriting the old verdict, so history stays intact.
  unique (resume_id, job_id)
);

create index if not exists job_matches_user_idx on public.job_matches (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row level security
--
-- The browser holds a publishable key, which grants exactly what these
-- policies allow and nothing else. Every table is locked by default and each
-- policy is scoped to auth.uid(), so a user can only ever reach their own
-- rows. This is the only thing standing between a visitor and everyone's
-- resumes, so it is switched on before any table is written to.
-- ---------------------------------------------------------------------------

alter table public.profiles    enable row level security;
alter table public.resumes     enable row level security;
alter table public.job_matches enable row level security;

drop policy if exists "own profile: read"   on public.profiles;
drop policy if exists "own profile: insert" on public.profiles;
drop policy if exists "own profile: update" on public.profiles;

create policy "own profile: read"   on public.profiles for select using (auth.uid() = id);
create policy "own profile: insert" on public.profiles for insert with check (auth.uid() = id);
create policy "own profile: update" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own resumes: read"   on public.resumes;
drop policy if exists "own resumes: write"  on public.resumes;
drop policy if exists "own resumes: update" on public.resumes;
drop policy if exists "own resumes: delete" on public.resumes;

create policy "own resumes: read"   on public.resumes for select using (auth.uid() = user_id);
create policy "own resumes: write"  on public.resumes for insert with check (auth.uid() = user_id);
create policy "own resumes: update" on public.resumes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own resumes: delete" on public.resumes for delete using (auth.uid() = user_id);

drop policy if exists "own matches: read"  on public.job_matches;
drop policy if exists "own matches: write" on public.job_matches;

create policy "own matches: read"  on public.job_matches for select using (auth.uid() = user_id);
create policy "own matches: write" on public.job_matches for insert with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Signup trigger: every auth user gets a profile row immediately.
--
-- Without this the app has to cope with a logged-in user who has no profile,
-- which is a state that exists for milliseconds and breaks things for years.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    -- Google returns a display name; email signup does not, so fall back to
    -- the local part of the address rather than leaving the greeting blank.
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Keep updated_at honest without the application having to remember.
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Private storage bucket for resumes.
--
-- Not public: a CV carries a home address and a phone number, and a guessable
-- public URL would expose every one of them. Files are namespaced by user id
-- so the policies can check ownership from the path itself.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;

drop policy if exists "own resume files: read"   on storage.objects;
drop policy if exists "own resume files: write"  on storage.objects;
drop policy if exists "own resume files: delete" on storage.objects;

create policy "own resume files: read" on storage.objects for select
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own resume files: write" on storage.objects for insert
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own resume files: delete" on storage.objects for delete
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);
