-- QuoteFlow schema. Plain SQL, idempotent (create ... if not exists).

create table if not exists users (
  id            serial primary key,
  email         text not null unique,
  name          text not null,
  role          text not null check (role in ('estimator', 'sales_head')),
  password_hash text not null,
  created_at    timestamptz not null default now()
);

create table if not exists rfqs (
  id          serial primary key,
  rfq_no      text not null unique,
  customer    text not null,
  received_on date not null default current_date,
  due_on      date not null,
  owner_id    integer references users(id),
  status      text not null default 'estimating'
              check (status in ('estimating', 'pending_approval', 'approved', 'sent', 'won', 'lost')),
  lost_reason text,
  source_text text,
  created_at  timestamptz not null default now(),
  check (status <> 'lost' or lost_reason is not null)
);
create index if not exists rfqs_status_due on rfqs (status, due_on);

create table if not exists parts (
  id               serial primary key,
  rfq_id           integer not null references rfqs(id) on delete cascade,
  line_no          integer not null,
  name             text not null,
  material_code    text not null,
  gross_wt_kg      numeric(10,3) not null check (gross_wt_kg > 0),
  net_wt_kg        numeric(10,3) not null check (net_wt_kg > 0),
  annual_volume    integer not null check (annual_volume > 0),
  tooling_cost     numeric(12,2) not null default 0 check (tooling_cost >= 0),
  packing_per_unit numeric(10,2) not null default 0 check (packing_per_unit >= 0),
  margin_pct       numeric(5,2) not null default 12 check (margin_pct >= 0 and margin_pct < 60),
  volumes          integer[] not null,
  -- field name -> where the pre-filled value came from, and whether the estimator accepted it
  sources          jsonb not null default '{}'::jsonb,
  unique (rfq_id, line_no),
  check (net_wt_kg <= gross_wt_kg)
);

create table if not exists routing_ops (
  id               serial primary key,
  part_id          integer not null references parts(id) on delete cascade,
  seq              integer not null,
  work_centre_code text not null,
  cycle_min        numeric(8,3) not null check (cycle_min >= 0),
  setup_min        numeric(8,2) not null default 0 check (setup_min >= 0),
  -- e.g. "past part #12 Gear blank (RFQ-2511-007)" when the row came from a suggestion
  suggested_from   text,
  unique (part_id, seq)
);

-- Append-only rate master. The "current" rate for a code on a date is the latest row
-- with effective_from <= that date. Old rows are never edited, so old quotes stay explainable.
create table if not exists rate_items (
  id             serial primary key,
  kind           text not null check (kind in ('material', 'work_centre', 'param')),
  code           text not null,
  label          text not null,
  unit           text not null,
  value          numeric(14,4) not null check (value >= 0),
  effective_from date not null,
  created_by     integer references users(id),
  created_at     timestamptz not null default now(),
  unique (kind, code, effective_from)
);
create index if not exists rate_items_lookup on rate_items (kind, code, effective_from desc);

-- Immutable costing snapshots: inputs, results and the exact rate rows used.
create table if not exists costings (
  id           serial primary key,
  part_id      integer not null references parts(id) on delete cascade,
  version      integer not null,
  pricing_date date not null,
  inputs       jsonb not null,
  result       jsonb not null,
  rates_used   jsonb not null,
  created_by   integer references users(id),
  created_at   timestamptz not null default now(),
  unique (part_id, version)
);

create table if not exists quotes (
  id              serial primary key,
  rfq_id          integer not null references rfqs(id) on delete cascade,
  version         integer not null,
  quote_no        text not null unique,
  status          text not null default 'pending_approval'
                  check (status in ('pending_approval', 'approved', 'rejected', 'sent')),
  annual_value    numeric(16,2) not null,
  needs_approval  boolean not null,
  submitted_by    integer references users(id),
  submitted_at    timestamptz not null default now(),
  decided_by      integer references users(id),
  decided_at      timestamptz,
  decision_note   text,
  sent_at         timestamptz,
  unique (rfq_id, version)
);

create table if not exists quote_lines (
  quote_id   integer not null references quotes(id) on delete cascade,
  part_id    integer not null references parts(id),
  costing_id integer not null references costings(id),
  primary key (quote_id, part_id)
);

create table if not exists activity (
  id         serial primary key,
  rfq_id     integer references rfqs(id) on delete cascade,
  user_id    integer references users(id),
  action     text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_rfq on activity (rfq_id, created_at desc);

-- Past quoted parts: used for "find what we quoted for a similar part" and routing suggestions.
create table if not exists past_parts (
  id            serial primary key,
  customer      text not null,
  part_name     text not null,
  material_code text not null,
  gross_wt_kg   numeric(10,3) not null,
  net_wt_kg     numeric(10,3),
  annual_volume integer not null,
  quoted_on     date not null,
  quoted_price  numeric(12,2) not null,
  outcome       text not null check (outcome in ('won', 'lost', 'open')),
  quote_ref     text not null,
  routing       jsonb not null default '[]'::jsonb
);
create index if not exists past_parts_material on past_parts (material_code);
