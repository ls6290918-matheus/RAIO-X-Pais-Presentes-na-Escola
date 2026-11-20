-- =====================================================================
-- LIMPA AQUI — limpeza de fotos órfãs do chat
-- O Supabase só deixa apagar arquivos pela API de armazenamento. As fotos do chat são permanentes
-- enquanto a conversa existe; quando a conversa é apagada (ex.: anúncio removido), quem enviou a foto
-- pode apagar o arquivo que sobrou.
-- =====================================================================
do $outer$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Storage não disponível neste banco.';
    return;
  end if;
  execute 'drop policy if exists chat_images_orphan_remove on storage.objects';
  execute $p$
    create policy chat_images_orphan_remove on storage.objects for delete to authenticated
      using (bucket_id = 'chat-images' and owner_id = auth.uid()::text
             and not exists (select 1 from public.conversations c where c.id = public.business_of_path(name)))
  $p$;
end
$outer$;
