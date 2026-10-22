create table if not exists rate_limit_buckets (
  ip_hash text not null,
  action text not null check (action in ('scan', 'lead')),
  window_started_at timestamptz not null default now(),
  request_count int not null default 1 check (request_count > 0),
  primary key (ip_hash, action)
);

create index if not exists rate_limit_buckets_window_started_at_idx
  on rate_limit_buckets (window_started_at);

comment on table rate_limit_buckets is
  'Atomic fixed-window rate-limit state; contains hashed network identifiers only.';
