-- Rappels : abonnements aux notifications de chaque appareil, et rappels déjà envoyés
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  keys jsonb not null,
  device text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create policy "push: chacun ses appareils" on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.reminders_sent (
  user_id uuid not null references auth.users on delete cascade,
  event_id text not null,
  fire_key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, event_id, fire_key)
);
alter table public.reminders_sent enable row level security;  -- réservé au serveur

-- Vérification des rappels chaque minute
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
do $$ begin
  if exists (select 1 from cron.job where jobname = 'cabine-rappels') then perform cron.unschedule('cabine-rappels'); end if;
end $$;
select cron.schedule('cabine-rappels', '* * * * *',
  $$ select net.http_post(url := 'https://mduzznbbpzonxutcegyb.supabase.co/functions/v1/reminders',
                          headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb) $$);
