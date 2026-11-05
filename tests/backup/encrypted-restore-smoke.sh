#!/usr/bin/env bash
# Disposable integration test: create synthetic database, encrypt it, decrypt
# with an ephemeral private key, restore to a second database, compare records.
# Never connects to or reads the live Supabase project.
set -Eeuo pipefail
umask 077

: "${PGPASSWORD:?Test-only PostgreSQL password required}"
for cmd in psql age age-keygen docker sha256sum; do command -v "$cmd" >/dev/null; done

base="postgresql://postgres:${PGPASSWORD}@127.0.0.1:5432"
psql "$base/postgres?sslmode=disable" -v ON_ERROR_STOP=1 -q <<'SQL'
create database tripsplit_backup_source;
create database tripsplit_backup_restore;
SQL

src="$base/tripsplit_backup_source?sslmode=disable"
dst="$base/tripsplit_backup_restore?sslmode=disable"
psql "$src" -v ON_ERROR_STOP=1 -q <<'SQL'
create schema app_private;
create schema auth;
create schema storage;
create schema supabase_migrations;
create table public.trips(id integer primary key, name text not null);
create table public.trip_members(trip_id integer, user_id integer);
create table public.expense_versions(id integer,trip_id integer,amount numeric);
create table public.settlement_versions(id integer,trip_id integer,amount numeric);
create table auth.users(id integer,email text);
create table storage.objects(id integer,name text);
create table supabase_migrations.schema_migrations(version text);
create function app_private.can_read() returns boolean language sql immutable as $fn$ select true $fn$;
insert into public.trips values (1,'Synthetic weekend trip');
insert into public.trip_members values (1,11),(1,12);
insert into public.expense_versions values (1,1,100.25),(2,1,50.50);
insert into public.settlement_versions values (1,1,25.12);
insert into auth.users values (11,'example1@invalid.test'),(12,'example2@invalid.test');
insert into storage.objects values (1,'placeholder-only-no-real-object');
insert into supabase_migrations.schema_migrations values ('20261105');
SQL

temp="$(mktemp -d)"
trap 'rm -rf -- "$temp"' EXIT
age-keygen -o "$temp/identity.txt" >/dev/null 2>&1
recipient="$(age-keygen -y "$temp/identity.txt")"
mkdir -p "$temp/output" "$temp/restored"

PG_URI="$src" AGE_RECIPIENT="$recipient" BACKUP_OUTPUT_DIR="$temp/output" \
  bash scripts/backup/create-encrypted-backup.sh

shopt -s nullglob
encrypted=("$temp/output/"*.tar.age)
if (( ${#encrypted[@]} != 1 )); then echo "Expected exactly one encrypted backup." >&2; exit 1; fi

age -d -i "$temp/identity.txt" "${encrypted[0]}" | tar -C "$temp/restored" -xf -
(cd "$temp/restored" && sha256sum -c SHA256SUMS >/dev/null)

# A second, unrelated private key must not decrypt the real encrypted artifact.
age-keygen -o "$temp/wrong-identity.txt" >/dev/null 2>&1
if age -d -i "$temp/wrong-identity.txt" "${encrypted[0]}" >/dev/null 2>&1; then
  echo "ERROR: an unrelated age identity decrypted the backup." >&2; exit 1
fi

# Only the test database is restored; --clean is NEVER used on live Supabase.
docker run --rm --network host \
  --volume "$temp/restored:/backup:ro" -e "PG_URI=$dst" postgres:17 \
  sh -ec 'exec pg_restore --exit-on-error --no-owner --no-acl --clean --if-exists --dbname="$PG_URI" /backup/tripsplit.dump'

test "$(psql "$dst" -Atc 'select count(*) from public.trips')" = "1"
test "$(psql "$dst" -Atc 'select count(*) from public.trip_members')" = "2"
test "$(psql "$dst" -Atc 'select sum(amount)::numeric(10,2) from public.expense_versions')" = "150.75"
test "$(psql "$dst" -Atc 'select sum(amount)::numeric(10,2) from public.settlement_versions')" = "25.12"
test "$(psql "$dst" -Atc 'select count(*) from auth.users')" = "2"
test "$(psql "$dst" -Atc 'select count(*) from storage.objects')" = "1"
test "$(psql "$dst" -Atc 'select count(*) from supabase_migrations.schema_migrations')" = "1"
test "$(psql "$dst" -Atc 'select app_private.can_read()')" = "t"

echo "PASS: encrypted offsite backup round-trip restored synthetic app/auth/storage/migration data."
