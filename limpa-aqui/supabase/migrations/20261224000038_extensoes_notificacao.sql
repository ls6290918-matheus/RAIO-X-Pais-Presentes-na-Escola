-- =====================================================================
-- LIMPA AQUI — Fase 1 / Subetapa 3: extensões para entregar notificações
--  * pg_net: o banco chama a Edge Function de envio sem esperar a resposta (assíncrono)
--  * pg_cron: rotina a cada minuto para reenviar o que falhou e limpeza diária
-- Em arquivo próprio (extensões). No banco local de testes elas não existem: o bloco só pula.
-- =====================================================================
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  else
    raise notice 'pg_net não disponível neste banco; envio automático fica desligado.';
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
  else
    raise notice 'pg_cron não disponível neste banco; reenvio automático fica desligado.';
  end if;
end $$;
