#!/usr/bin/env bash
# Roda os testes do banco num PostgreSQL local (não usa o Supabase real).
# Uso: PGHOST=... PGPORT=... PGUSER=postgres ./supabase/tests/run_local.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=limpaaqui_test
psql -q -v ON_ERROR_STOP=1 -c "drop database if exists $DB" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/00_supabase_shim.sql
for f in migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d $DB -f "$f"; done
# Os arquivos de teste rodam em sequência na mesma sessão (cada etapa usa os dados da anterior)
cat tests/[1-9]*_tests.sql | psql -q -v ON_ERROR_STOP=1 -d $DB 2>&1 | grep -E "OK|ERROR|FALHOU"
