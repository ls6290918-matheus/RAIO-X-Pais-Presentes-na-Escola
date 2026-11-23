#!/usr/bin/env bash
# Concorrência real do limite de corridas (Fase 1 / Subetapa 2).
# Abre sessões simultâneas no banco local de testes (limpaaqui_test, criado por run_local.sh).
# NÃO use contra produção.
# Uso: PGHOST=... PGUSER=postgres bash supabase/tests/concorrencia/limite_corridas.sh
set -euo pipefail
DB=${DB:-limpaaqui_test}
case "$DB" in *test*) ;; *) echo "Recusado: este script só roda em banco de teste (DB=$DB)."; exit 1 ;; esac
q() { psql -qtA -d "$DB" -c "$1"; }
E19=19191919-0000-0000-0000-000000000019
E21=21212121-0000-0000-0000-000000000021
MUN=3303302
TMP=$(mktemp -d)
fail=0

# Prepara: os dois entregadores online, sem corrida em andamento, limite 1, e N corridas livres
prepare() { # $1 = quantas corridas criar
  q "update public.platform_settings set max_active_deliveries = 1 where id;
     update public.couriers set online = true where user_id in ('$E19', '$E21');
     update public.deliveries set status = 'cancelada', canceled_at = now() where courier_id in ('$E19', '$E21') and status in ('aceita', 'coletada');
     update public.deliveries set status = 'cancelada', canceled_at = now() where status = 'disponivel';" > /dev/null
  q "with o as (select o.id, o.business_id from public.orders o
                where not exists (select 1 from public.deliveries d where d.order_id = o.id and d.leg = 'pickup' and d.status <> 'cancelada')
                limit $1)
     insert into public.deliveries (order_id, business_id, leg, municipality_id, origin_label, origin_address, dest_label, dest_address,
                                    distance_km, delivery_fee, courier_earnings, status)
     select id, business_id, 'pickup', $MUN, 'Cliente', 'Rua A, 1', 'Lavanderia', 'Rua B, 2', 3, 12, 10, 'disponivel' from o
     returning id"
}
accept() { # $1 entregador $2 corrida $3 segundos segurando $4 saída
  psql -qtA -d "$DB" > "$4" 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '$1', true);
select 'ACEITOU' from (select public.accept_delivery('$2')) x;
select pg_sleep($3);
commit;
SQL
}
active() { q "select count(*) from public.deliveries where courier_id = '$1' and status in ('aceita', 'coletada')"; }
check() { if [ "$1" = "$2" ]; then echo "  ok   $3"; else echo "  FALHOU $3 (esperado $2, veio $1)"; fail=1; fi; }
ok_count() { grep -l "ACEITOU" "$@" 2>/dev/null | wc -l | tr -d ' '; }

echo "L1: o mesmo entregador aceita duas corridas ao mesmo tempo (a 1ª transação fica aberta 2 s)"
mapfile -t D < <(prepare 2)
start=$(date +%s%N)
accept $E19 "${D[0]}" 2 "$TMP/a" &
sleep 0.3
accept $E19 "${D[1]}" 0 "$TMP/b" &
wait
waited=$(( ($(date +%s%N) - start) / 1000000 ))
check "$(active $E19)" 1 "só uma corrida ativa"
check "$(ok_count "$TMP/a" "$TMP/b")" 1 "um aceite deu certo"
grep -q "Você já possui uma entrega em andamento" "$TMP/b" && echo "  ok   o segundo recebeu a mensagem do limite" || { echo "  FALHOU mensagem do limite"; cat "$TMP/b"; fail=1; }
[ "$waited" -ge 1900 ] && echo "  ok   o segundo esperou o primeiro terminar (${waited} ms)" || { echo "  FALHOU o segundo não esperou (${waited} ms)"; fail=1; }

echo "L2: o mesmo entregador dispara 10 aceites em 10 corridas ao mesmo tempo"
mapfile -t D < <(prepare 10)
for i in $(seq 0 9); do accept $E19 "${D[$i]}" 0 "$TMP/r$i" & done
wait
check "$(active $E19)" 1 "só uma corrida ativa"
check "$(ok_count "$TMP"/r*)" 1 "só um aceite deu certo"

echo "L3: dois entregadores na mesma corrida ao mesmo tempo"
mapfile -t D < <(prepare 1)
accept $E19 "${D[0]}" 1 "$TMP/c" &
accept $E21 "${D[0]}" 1 "$TMP/d" &
wait
check "$(ok_count "$TMP/c" "$TMP/d")" 1 "só um ficou com a corrida"
check "$(q "select count(*) from public.deliveries where id = '${D[0]}' and status = 'aceita'")" 1 "corrida aceita uma vez"

echo "L4: dois entregadores, corridas diferentes, ao mesmo tempo"
mapfile -t D < <(prepare 2)
accept $E19 "${D[0]}" 1 "$TMP/e" &
accept $E21 "${D[1]}" 1 "$TMP/f" &
wait
check "$(ok_count "$TMP/e" "$TMP/f")" 2 "os dois aceitaram"

# deixa o banco de teste como estava (limite 1, nada em andamento)
prepare 0 > /dev/null
rm -rf "$TMP"
[ "$fail" = 0 ] && echo "CONCORRÊNCIA OK" || { echo "CONCORRÊNCIA FALHOU"; exit 1; }
