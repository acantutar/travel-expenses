#!/usr/bin/env bash
# TripSplit P0: encrypt a consistent PostgreSQL 17 logical snapshot before it
# leaves the ephemeral runner. No database credentials or plaintext are uploaded.
set -Eeuo pipefail
umask 077

: "\${PG_URI:?Set PG_URI to a PostgreSQL session-pooler or direct database URI}"
: "\${AGE_RECIPIENT:?Set AGE_RECIPIENT to an age1... public recipient}"
: "\${BACKUP_OUTPUT_DIR:?Set BACKUP_OUTPUT_DIR to an output directory}"

if [[ ! "\${AGE_RECIPIENT}" =~ ^age1[0-9a-z]+$ ]]; then
  echo "Invalid age recipient. Use the age1... public key, not the private identity." >&2
  exit 2
fi
command -v docker >/dev/null
command -v age >/dev/null
command -v tar >/dev/null
command -v sha256sum >/dev/null

mkdir -p "\${BACKUP_OUTPUT_DIR}"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT

# One pg_dump invocation = one transactionally consistent DB snapshot.
# PostgreSQL 17 matches the live Supabase engine. Include app data,
# account identities, storage metadata and migration history.
docker run --rm --network host -e PG_URI postgres:17 \
  sh -ec 'exec pg_dump --dbname="$PG_URI" --format=custom --no-owner --schema=public --schema=app_private --schema=auth --schema=storage --schema=supabase_migrations' \
  > "$work/tripsplit.dump"

if [[ ! -s "$work/tripsplit.dump" ]]; then
  echo "Backup is empty; refusing to upload." >&2
  exit 1
fi

docker run --rm --volume "$work:/backup:ro" postgres:17 \
  pg_restore --list /backup/tripsplit.dump > "$work/toc.txt"

for entry in \
  'TABLE DATA public trips' \
  'TABLE DATA public trip_members' \
  'TABLE DATA public expense_versions' \
  'TABLE DATA public settlement_versions' \
  'TABLE DATA auth users'; do
  if ! grep -Fq "$entry" "$work/toc.txt"; then
    echo "Critical backup section is missing: $entry" >&2
    exit 1
  fi
done

printf 'format=pg_dump_custom\npostgres_major=17\nschemas=public,app_private,auth,storage,supabase_migrations\ncreated_utc=%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$work/manifest.txt"
(
  cd "$work"
  sha256sum tripsplit.dump > SHA256SUMS
)

outfile="\${BACKUP_OUTPUT_DIR%/}/tripsplit-$(date -u +%Y%m%dT%H%M%SZ).tar.age"
if [[ -e "$outfile" ]]; then
  echo "Refusing to overwrite an existing backup file." >&2
  exit 1
fi

# Only the age ciphertext becomes a GitHub Actions artifact.
tar -C "$work" -cf - tripsplit.dump manifest.txt SHA256SUMS | \
  age -r "$AGE_RECIPIENT" -o "$outfile"

test -s "$outfile"
echo "Encrypted TripSplit backup created successfully."
