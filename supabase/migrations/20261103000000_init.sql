-- Données de l'application : un document JSON par élément (profil, client, facture, date…)
create table if not exists public.items (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  col text not null,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, col, id)
);
alter table public.items enable row level security;
create policy "items: chacun ses données" on public.items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
alter table public.items replica identity full;
alter publication supabase_realtime add table public.items;

-- Jeton Google (Gmail + Agenda). Jamais lisible depuis le navigateur.
create table if not exists public.google_tokens (
  user_id uuid primary key references auth.users on delete cascade,
  refresh_token text not null,
  email text,
  updated_at timestamptz not null default now()
);
alter table public.google_tokens enable row level security;
create policy "tokens: écriture par le propriétaire" on public.google_tokens
  for insert with check (user_id = auth.uid());
create policy "tokens: mise à jour par le propriétaire" on public.google_tokens
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Réglages de la page de réservation
create table if not exists public.booking_settings (
  user_id uuid primary key references auth.users on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.booking_settings enable row level security;
create policy "booking_settings: propriétaire" on public.booking_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Demandes de rendez-vous envoyées par les clients
create table if not exists public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  status text not null default 'pending', -- pending | accepted | proposed | declined
  slot_start timestamptz,
  slot_end timestamptz,
  form jsonb not null default '{}'::jsonb,
  proposals jsonb not null default '[]'::jsonb,
  token text not null unique default replace(gen_random_uuid()::text, '-', '')
);
alter table public.booking_requests enable row level security;
create policy "booking_requests: propriétaire" on public.booking_requests
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
alter publication supabase_realtime add table public.booking_requests;
create policy "tokens: lecture par le propriétaire" on public.google_tokens
  for select using (user_id = auth.uid());
