#!/usr/bin/env bash
# Concorrência real da idempotência (Fase 1 / Subetapa 1).
# Abre sessões simultâneas no banco local de testes (limpaaqui_test, criado por run_local.sh)
# e confere que a mesma tentativa nunca vira dois pedidos. NÃO use contra produção.
# Uso: PGHOST=... PGUSER=postgres bash supabase/tests/concorrencia/idempotencia.sh
set -euo pipefail
DB=${DB:-limpaaqui_test}
case "$DB" in *test*) ;; *) echo "Recusado: este script só roda em banco de teste (DB=$DB)."; exit 1 ;; esac
q() { psql -qtA -d "$DB" -c "$1"; }

BIZ=$(q "select id from public.businesses where slug = 'lavanderia-do-joao'")
SVC=$(q "select id from public.services where business_id = '$BIZ' and active and pricing_unit = 'unidade' limit 1")
A18=$(q "select id from public.user_addresses where user_id = '18181818-0000-0000-0000-000000000018' limit 1")
A17=$(q "select id from public.user_addresses where user_id = '17171717-0000-0000-0000-000000000017' limit 1")
CUST=$(q "select id from public.customers where business_id = '$BIZ' limit 1")
ITEMS="jsonb_build_array(jsonb_build_object('service_id', '$SVC'::uuid, 'quantity', 1))"
TMP=$(mktemp -d)
fail=0

# Uma sessão: entra como o usuário, chama a função e (opcional) segura a transação aberta por alguns segundos
session() { # $1=usuário $2=chamada SQL $3=segundos segurando $4=arquivo de saída
  psql -qtA -d "$DB" -v ON_ERROR_STOP=1 > "$4" 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '$1', true);
select 'pedido=' || $2;
select pg_sleep($3);
commit;
SQL
}
hire() { echo "public.hire_services('$BIZ', $ITEMS, '$1', p_request_id => '$2')"; }
count_key() { q "select count(*) from public.orders where client_request_id = '$1'"; }
check() { if [ "$1" = "$2" ]; then echo "  ok   $3"; else echo "  FALHOU $3 (esperado $2, veio $1)"; fail=1; fi; }
order_of() { grep -o 'pedido=[0-9a-f-]*' "$1" | cut -d= -f2; }

echo "C1: dois cliques simultâneos com a mesma chave (a 1ª transação fica aberta 2 s)"
K=$(q "select gen_random_uuid()")
start=$(date +%s%N)
session 18181818-0000-0000-0000-000000000018 "$(hire "$A18" "$K")" 2 "$TMP/a" &
sleep 0.3
session 18181818-0000-0000-0000-000000000018 "$(hire "$A18" "$K")" 0 "$TMP/b" &
wait
waited=$(( ($(date +%s%N) - start) / 1000000 ))
check "$(count_key "$K")" 1 "um pedido só"
check "$(order_of "$TMP/a")" "$(order_of "$TMP/b")" "a segunda requisição recebeu o pedido original"
[ "$waited" -ge 1900 ] && echo "  ok   a segunda esperou a primeira terminar (${waited} ms)" || { echo "  FALHOU a segunda não esperou (${waited} ms)"; fail=1; }

echo "C2: dez requisições simultâneas com a mesma chave"
K=$(q "select gen_random_uuid()")
for i in $(seq 1 10); do session 18181818-0000-0000-0000-000000000018 "$(hire "$A18" "$K")" 0 "$TMP/r$i" & done
wait
check "$(count_key "$K")" 1 "um pedido só"
check "$(for i in $(seq 1 10); do order_of "$TMP/r$i"; done | sort -u | wc -l | tr -d ' ')" 1 "todas devolveram o mesmo pedido"

echo "C3: mesmo cliente, duas contratações diferentes ao mesmo tempo"
K1=$(q "select gen_random_uuid()"); K2=$(q "select gen_random_uuid()")
session 18181818-0000-0000-0000-000000000018 "$(hire "$A18" "$K1")" 1 "$TMP/c" &
session 18181818-0000-0000-0000-000000000018 "$(hire "$A18" "$K2")" 1 "$TMP/d" &
wait
check "$(( $(count_key "$K1") + $(count_key "$K2") ))" 2 "dois pedidos"

echo "C4: dois clientes contratando ao mesmo tempo (até com a mesma chave)"
K=$(q "select gen_random_uuid()")
session 18181818-0000-0000-0000-000000000018 "$(hire "$A18" "$K")" 1 "$TMP/e" &
session 17171717-0000-0000-0000-000000000017 "$(hire "$A17" "$K")" 1 "$TMP/f" &
wait
check "$(count_key "$K")" 2 "um pedido para cada cliente"
[ "$(order_of "$TMP/e")" != "$(order_of "$TMP/f")" ] && echo "  ok   pedidos diferentes" || { echo "  FALHOU mesmo pedido para clientes diferentes"; fail=1; }

echo "C5: pedido de balcão, dois cliques simultâneos"
K=$(q "select gen_random_uuid()")
session aaaaaaaa-0000-0000-0000-000000000001 "public.create_order('$CUST', $ITEMS, p_request_id => '$K')" 1 "$TMP/g" &
sleep 0.2
session aaaaaaaa-0000-0000-0000-000000000001 "public.create_order('$CUST', $ITEMS, p_request_id => '$K')" 0 "$TMP/h" &
wait
check "$(count_key "$K")" 1 "um pedido só"
check "$(order_of "$TMP/g")" "$(order_of "$TMP/h")" "mesmo pedido nas duas respostas"

if grep -l "ERROR" "$TMP"/* >/dev/null 2>&1; then echo "Erros nas sessões:"; grep -h "ERROR" "$TMP"/*; fail=1; fi
rm -rf "$TMP"
[ "$fail" = 0 ] && echo "CONCORRÊNCIA OK" || { echo "CONCORRÊNCIA FALHOU"; exit 1; }
