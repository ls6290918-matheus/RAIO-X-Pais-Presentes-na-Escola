-- =====================================================================
-- LIMPA AQUI — Onboarding dinâmico, Etapa 5: fotos de antes e depois
--  * order_photos: registro das fotos de cada pedido (antes / depois)
--  * bucket PRIVADO "order-photos": arquivos em <empresa>/<pedido>/<arquivo>
--    só membros da empresa leem, enviam e apagam (visualização por link assinado)
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'photo_kind') then
    create type public.photo_kind as enum ('antes', 'depois');
  end if;
end$$;

create table if not exists public.order_photos (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null,
  order_id     uuid not null,
  kind         public.photo_kind not null,
  path         text not null unique check (char_length(path) between 10 and 300),
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  foreign key (business_id, order_id) references public.orders (business_id, id) on delete cascade,
  -- o arquivo precisa estar na pasta da própria empresa e do próprio pedido
  check (path like business_id::text || '/' || order_id::text || '/%')
);

create index if not exists order_photos_order_idx on public.order_photos (order_id, kind, created_at);

-- No máximo 12 fotos por pedido
create or replace function public.limit_order_photos()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.order_photos where order_id = new.order_id) >= 12 then
    raise exception 'Cada pedido pode ter no máximo 12 fotos.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger order_photos_limit
  before insert on public.order_photos
  for each row execute function public.limit_order_photos();

alter table public.order_photos enable row level security;

create policy order_photos_select_member on public.order_photos
  for select to authenticated using (public.is_business_member(business_id));
create policy order_photos_insert_member on public.order_photos
  for insert to authenticated with check (public.is_business_member(business_id));
create policy order_photos_delete_member on public.order_photos
  for delete to authenticated using (public.is_business_member(business_id));

revoke all on public.order_photos from anon, authenticated;
grant select, delete on public.order_photos to authenticated;
grant insert (business_id, order_id, kind, path) on public.order_photos to authenticated;
revoke all on function public.limit_order_photos() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Pasta do Storage → empresa. "<uuid da empresa>/..." vira o uuid; qualquer outra coisa, nulo.
-- ---------------------------------------------------------------------
create or replace function public.business_of_path(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end;
$$;

grant execute on function public.business_of_path(text) to authenticated;

-- ---------------------------------------------------------------------
-- Bucket privado (só onde existe o Storage do Supabase)
-- ---------------------------------------------------------------------
do $outer$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Storage não disponível neste banco; bucket de fotos não criado.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('order-photos', 'order-photos', false, 3145728, array['image/jpeg', 'image/webp'])
  on conflict (id) do update
    set public = false, file_size_limit = 3145728, allowed_mime_types = array['image/jpeg', 'image/webp'];

  execute 'drop policy if exists order_photos_read on storage.objects';
  execute 'drop policy if exists order_photos_write on storage.objects';
  execute 'drop policy if exists order_photos_remove on storage.objects';

  execute $p$
    create policy order_photos_read on storage.objects for select to authenticated
      using (bucket_id = 'order-photos' and public.is_business_member(public.business_of_path(name)))
  $p$;
  execute $p$
    create policy order_photos_write on storage.objects for insert to authenticated
      with check (bucket_id = 'order-photos' and public.is_business_member(public.business_of_path(name)))
  $p$;
  execute $p$
    create policy order_photos_remove on storage.objects for delete to authenticated
      using (bucket_id = 'order-photos' and public.is_business_member(public.business_of_path(name)))
  $p$;
end
$outer$;

update public.features set status = 'disponivel' where code = 'fotos';
