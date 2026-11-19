-- Testes do aceite dos Termos de Uso e da Política de Privacidade. Roda por último.
\set ON_ERROR_STOP on
\set QUIET on

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('31313131-0000-0000-0000-000000000031', 'novo-termos@teste.com', '{"full_name":"Nova Pessoa","terms_version":"2026-11-19"}');
do $$ begin
  assert (select terms_version = '2026-11-19' and terms_accepted_at is not null from public.profiles where id = '31313131-0000-0000-0000-000000000031'),
         'T153 aceite no cadastro';
  assert (select terms_version is null from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'T153 conta antiga sem aceite';
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$ begin
  begin perform public.accept_terms(''); raise exception 'T153 FALHOU versão vazia';
  exception when others then if sqlerrm like 'T153%' then raise; end if; end;
  perform public.accept_terms('2026-11-19');
  assert (select terms_version = '2026-11-19' and terms_accepted_at > now() - interval '1 minute' from public.profiles where id = auth.uid()), 'T153 aceite ao entrar';
end $$;
reset role;
set role anon;
do $$ begin
  begin perform public.accept_terms('2026-11-19'); raise exception 'T153 FALHOU anon';
  exception when insufficient_privilege then null; end;
  raise notice 'T153 OK  aceite dos termos gravado no cadastro (versão e data) e ao entrar; visitante não aceita por ninguém';
end $$;
reset role;
