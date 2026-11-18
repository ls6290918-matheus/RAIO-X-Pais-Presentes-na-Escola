-- =====================================================================
-- LIMPA AQUI — Logotipos (Supabase Storage)
-- Bucket público "logos" (o logotipo aparece no painel e, depois, na página pública).
-- Cada usuário só envia, troca ou apaga arquivos dentro da própria pasta: logos/<id do usuário>/...
-- Só roda onde existe o Storage do Supabase (o banco de testes local não tem e pula este bloco).
-- =====================================================================
do $outer$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Storage não disponível neste banco; bucket de logotipos não criado.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('logos', 'logos', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do update
    set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];

  execute 'drop policy if exists logos_insert_own on storage.objects';
  execute 'drop policy if exists logos_update_own on storage.objects';
  execute 'drop policy if exists logos_delete_own on storage.objects';

  execute $p$
    create policy logos_insert_own on storage.objects for insert to authenticated
      with check (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text)
  $p$;
  execute $p$
    create policy logos_update_own on storage.objects for update to authenticated
      using (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text)
      with check (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text)
  $p$;
  execute $p$
    create policy logos_delete_own on storage.objects for delete to authenticated
      using (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text)
  $p$;
end
$outer$;
