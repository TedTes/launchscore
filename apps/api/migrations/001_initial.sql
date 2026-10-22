create extension if not exists pgcrypto;

create table if not exists scans (
  id uuid primary key default gen_random_uuid(),
  input_url text not null,
  normalized_url text not null,
  ip_hash text not null,
  status text not null check (status in ('running','done','failed')),
  total int,
  result jsonb,
  methodology_version text not null default '1.0.0',
  created_at timestamptz not null default now()
);
create index if not exists scans_normalized_url_created_at_idx on scans (normalized_url, created_at desc);
create index if not exists scans_ip_hash_created_at_idx on scans (ip_hash, created_at desc);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  scan_id uuid references scans(id),
  ip_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists leads_ip_hash_created_at_idx on leads (ip_hash, created_at desc);
