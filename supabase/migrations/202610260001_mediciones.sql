create table if not exists public.mediciones_meteorologicas (
  id bigint generated always as identity primary key,
  ciudad text not null check (length(trim(ciudad)) between 1 and 100),
  fecha_hora timestamptz not null,
  temperatura_c double precision not null check (temperatura_c > '-Infinity'::float8 and temperatura_c < 'Infinity'::float8),
  humedad_pct double precision not null check (humedad_pct between 0 and 100),
  precipitacion_mm double precision not null check (precipitacion_mm >= 0 and precipitacion_mm < 'Infinity'::float8),
  importado_en timestamptz not null default now(),
  unique (ciudad, fecha_hora)
);
create index if not exists mediciones_fecha_idx on public.mediciones_meteorologicas (fecha_hora);
alter table public.mediciones_meteorologicas enable row level security;
revoke all on public.mediciones_meteorologicas from anon, authenticated;
grant all on public.mediciones_meteorologicas to service_role;
grant usage, select on sequence public.mediciones_meteorologicas_id_seq to service_role;
