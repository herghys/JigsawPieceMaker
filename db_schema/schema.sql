-- Jigsaw Piece Creator: Supabase schema.
-- Paste into Supabase Dashboard, open the SQL Editor, and Run.
--
-- Model: the live catalog (knob_profiles) is only ever written via the
-- Vercel API with the service key. "Request Save to db" writes land in
-- knob_requests as pending. Approve them below (or build the admin tick later).

create table if not exists knob_profiles (
  id             bigint generated always as identity primary key,
  slug           text not null unique,
  name           text not null,
  description    text not null default '',
  control_points jsonb not null,
  is_builtin     boolean not null default false,
  created_at     timestamptz not null default now()
);

create table if not exists knob_requests (
  id             bigint generated always as identity primary key,
  kind           text not null check (kind in ('create', 'update', 'delete')),
  profile_id     bigint references knob_profiles (id) on delete cascade,
  slug           text,
  name           text,
  description    text,
  control_points jsonb,
  status         text not null default 'pending'
                 check (status in ('pending', 'approved', 'rejected')),
  created_at     timestamptz not null default now()
);

-- Locked down: NO public policies. The service key bypasses RLS,
-- so only the Vercel API can read/write.
alter table knob_profiles enable row level security;
alter table knob_requests enable row level security;

-- Built-in seed (idempotent).
insert into knob_profiles (slug, name, description, control_points, is_builtin) values
('classic', 'Classic', 'Round head, narrow neck',
 '[[0,0],[0.34,0],[0.37,0.2],[0.33,0.4],[0.38,0.65],[0.5,0.85],[0.62,0.65],[0.67,0.4],[0.63,0.2],[0.66,0],[1,0]]', true),
('classic_rounded', 'Classic Rounded', 'Classic with a slightly flatter head',
 '[[0,0],[0.34,0],[0.37,0.2],[0.33,0.4],[0.38,0.65],[0.5,0.75],[0.62,0.65],[0.67,0.4],[0.63,0.2],[0.66,0],[1,0]]', true),
('rounded', 'Rounded', 'Soft wide bump, no pinched neck',
 '[[0,0],[0.34,0],[0.38,0.65],[0.5,0.85],[0.62,0.65],[0.66,0],[1,0]]', true),
('bulb', 'Bulb', 'Tall round bulb with deep neck',
 '[[0,0],[0.38,0],[0.4,0.1],[0.32,0.35],[0.36,0.8],[0.5,1],[0.64,0.8],[0.68,0.35],[0.6,0.1],[0.62,0],[1,0]]', true),
('arrowhead', 'Arrowhead', 'Pointed triangular-ish tab',
 '[[0,0],[0.36,0],[0.4,0.15],[0.35,0.3],[0.42,0.6],[0.5,0.8],[0.58,0.6],[0.65,0.3],[0.6,0.15],[0.64,0],[1,0]]', true)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  control_points = excluded.control_points,
  is_builtin = excluded.is_builtin;

-- ---------- approval snippets (run one per request) ----------
-- Approve a create:
--   insert into knob_profiles (slug, name, description, control_points)
--   select slug, name, coalesce(description,''), control_points
--   from knob_requests where id = :request_id and kind = 'create';
--   update knob_requests set status = 'approved' where id = :request_id;
--
-- Approve an update:
--   update knob_profiles p set
--     name = r.name, description = coalesce(r.description, p.description),
--     control_points = r.control_points
--   from knob_requests r where r.id = :request_id and r.kind = 'update'
--     and p.id = r.profile_id;
--   update knob_requests set status = 'approved' where id = :request_id;
--
-- Approve a delete:
--   delete from knob_profiles p using knob_requests r
--   where r.id = :request_id and r.kind = 'delete' and p.id = r.profile_id
--     and p.is_builtin = false;
--   update knob_requests set status = 'approved' where id = :request_id;
