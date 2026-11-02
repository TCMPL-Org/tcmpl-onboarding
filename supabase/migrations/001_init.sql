create extension if not exists pgcrypto;
create table if not exists public.app_config(id uuid primary key default gen_random_uuid(), tenant_key text not null, config_key text not null, config_value jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), unique(tenant_key,config_key));
alter table public.app_config enable row level security;
create policy "authenticated config read" on public.app_config for select to authenticated using (true);
