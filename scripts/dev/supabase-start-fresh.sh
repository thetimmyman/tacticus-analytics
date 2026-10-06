#!/usr/bin/env bash
# Starts the Supabase CLI stack with its own migration pass and seed
# disabled, then replays this repository's migrations and seed itself via
# scripts/dev/lib/replay-migrations.sh -- the same helper the pgTAP and
# integration lanes use. See README.md for why the CLI's own migration
# pass cannot finish on a brand-new database.
# Usage: scripts/dev/supabase-start-fresh.sh [extra `supabase start` args]
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 1

PROJECT_ID="$(sed -n 's/^project_id[[:space:]]*=[[:space:]]*"\(.*\)"/\1/p' supabase/config.toml | head -1)"
[ -n "$PROJECT_ID" ] || { echo "could not read project_id from supabase/config.toml" >&2; exit 2; }
DB_CONTAINER="supabase_db_${PROJECT_ID}"
CONTAINER_DIR="/supabase-start-fresh"

# Workdir: config.toml copy with migrations and seed disabled, template and
# function copies, empty migrations dir. A copy, not a symlink: the CLI
# refuses a content_path that resolves outside the workdir.
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/supabase-start-fresh.XXXXXXXX")"
cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

mkdir -p "$WORK_DIR/supabase/migrations"
# Disable the CLI's own migrations (this script replays them) and seed
# (applied manually below, after the replay, since it needs the migrated
# schema).
sed -e '/^\[db\.migrations\]/,/^\[/ s/^enabled = true/enabled = false/' \
    -e '/^\[db\.seed\]/,/^\[/ s/^enabled = true/enabled = false/' \
    supabase/config.toml > "$WORK_DIR/supabase/config.toml"
cp -R "$REPO_ROOT/supabase/templates" "$WORK_DIR/supabase/templates"
cp -R "$REPO_ROOT/supabase/functions" "$WORK_DIR/supabase/functions"

supa() { npx --no-install supabase --workdir "$WORK_DIR" "$@"; }

echo "== starting the Supabase CLI stack (this script applies migrations and the seed, not the CLI) =="
if ! supa start "$@"; then
  echo "supabase-start-fresh: the Supabase stack containers did not start" >&2
  exit 1
fi

# replay_migrations has no concept of "already applied" -- it just tries
# every migration file, which fails non-idempotent ones the second time
# around. Detect our own baseline ledger row instead of re-running it
# against a database this script already migrated (a still-running stack,
# or one restarted without `stop --no-backup`, which keeps its volume).
BASELINE_LEDGERED="$(docker exec -i "$DB_CONTAINER" psql -Atq -U postgres -d postgres -c \
  "SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL" 2>/dev/null)"
if [ "$BASELINE_LEDGERED" = "t" ]; then
  BASELINE_LEDGERED="$(docker exec -i "$DB_CONTAINER" psql -Atq -U postgres -d postgres -c \
    "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260813000000'")"
else
  BASELINE_LEDGERED="0"
fi

if [ "$BASELINE_LEDGERED" != "0" ]; then
  echo "== database already has this repository's migrations and seed applied -- skipping the replay =="
  echo
  echo "Supabase stack is up. Run 'npm run supabase:status' for the API URL and keys."
  exit 0
fi

echo "== replaying this repository's migrations =="
# shellcheck source=scripts/dev/lib/replay-migrations.sh
. "$REPO_ROOT/scripts/dev/lib/replay-migrations.sh"
if ! replay_migrations "$DB_CONTAINER" "$REPO_ROOT" "$CONTAINER_DIR"; then
  echo "supabase-start-fresh: the migration replay left the schema incomplete (see the UNEXPECTED lines above)" >&2
  exit 1
fi

# replay_migrations applies 20260813000000_clean_baseline.sql directly and
# does not ledger it (it is the baseline, not a tracked step for the other
# lanes that call this helper). Ledger it here so `supabase migration list`
# shows it as applied instead of a phantom local-only migration.
docker exec -i "$DB_CONTAINER" psql -q -U postgres -d postgres -c \
  "INSERT INTO supabase_migrations.schema_migrations(version, name)
     VALUES ('20260813000000', 'clean_baseline') ON CONFLICT DO NOTHING;" >/dev/null

echo "== seeding the database (supabase/seed.sql) =="
docker exec "$DB_CONTAINER" mkdir -p "$CONTAINER_DIR" >/dev/null
docker cp "$REPO_ROOT/supabase/seed.sql" "$DB_CONTAINER":"$CONTAINER_DIR/seed.sql" >/dev/null
if ! docker exec -i "$DB_CONTAINER" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
     -f "$CONTAINER_DIR/seed.sql"; then
  echo "supabase-start-fresh: supabase/seed.sql failed to apply" >&2
  exit 1
fi

echo "== reloading the PostgREST schema cache =="
docker exec -i "$DB_CONTAINER" psql -q -U postgres -d postgres \
  -c "NOTIFY pgrst, 'reload schema';" >/dev/null

echo
echo "Supabase stack is up with this repository's migrations and seed applied."
echo "Run 'npm run supabase:status' for the API URL and keys."
