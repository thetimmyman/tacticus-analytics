#!/usr/bin/env bash
# Run the RLS and GDPR integration suites against a local Supabase stack built
# by the pgTAP gate's migration replay. Not `set -e`: failing migrations are tolerated.
# Usage: scripts/dev/integration-replay-stack.sh [up|down]   (KEEP_STACK=1 keeps it running)
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 1

PROJECT_ID="$(sed -n 's/^project_id[[:space:]]*=[[:space:]]*"\(.*\)"/\1/p' supabase/config.toml | head -1)"
[ -n "$PROJECT_ID" ] || { echo "could not read project_id from supabase/config.toml" >&2; exit 2; }
DB_CONTAINER="supabase_db_${PROJECT_ID}"

EXCLUDED='studio,realtime,edge-runtime,logflare,vector,supavisor,mailpit,postgres-meta'

# Declared live-only gaps; a gap that stops being true fails the suite. No migration defines
# prepare_player_account_deletion, so complete erasure cannot run on a replay.
export GDPR_LIVE_ONLY_GAPS="${GDPR_LIVE_ONLY_GAPS:-prepare_player_account_deletion}"

# Workdir: config.toml copy with two flags flipped, template/function symlinks, empty migrations dir.
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/integration-replay.XXXXXXXX")"

# Tear down the stack on any exit so a persistent runner is not left with
# containers. Armed only once a stack is requested, so `$0 up` leaves it up.
TEARDOWN_STACK=0
cleanup() {
  local rc=$?
  trap - EXIT
  if [ "$TEARDOWN_STACK" = "1" ] && [ -z "${KEEP_STACK:-}" ]; then
    stack_down
  fi
  rm -rf "$WORK_DIR"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$WORK_DIR/supabase/migrations"
# Disable CLI migrations (the replay applies them) and the seed, which needs the migrated schema.
sed -e '/^\[db\.migrations\]/,/^\[/ s/^enabled = true/enabled = false/' \
    -e '/^\[db\.seed\]/,/^\[/ s/^enabled = true/enabled = false/' \
    supabase/config.toml > "$WORK_DIR/supabase/config.toml"
ln -s "$REPO_ROOT/supabase/templates" "$WORK_DIR/supabase/templates"
ln -s "$REPO_ROOT/supabase/functions" "$WORK_DIR/supabase/functions"

supa() { npx --no-install supabase --workdir "$WORK_DIR" "$@"; }

stack_down() {
  echo "== stopping the stack =="
  # --no-backup, or the next start restores the volume and replays over its output.
  supa stop --no-backup >/dev/null 2>&1 || true
}

stack_up() {
  echo "== starting the Supabase stack (without $EXCLUDED) =="
  if ! supa start -x "$EXCLUDED" >/dev/null; then
    echo "integration-replay: HARNESS FAILURE -- the Supabase stack did not start" >&2
    exit 1
  fi

  echo "== replaying this repository's migrations =="
  # shellcheck source=scripts/dev/lib/replay-migrations.sh
  . "$REPO_ROOT/scripts/dev/lib/replay-migrations.sh"
  if ! replay_migrations "$DB_CONTAINER" "$REPO_ROOT" "/integration-replay"; then
    echo "integration-replay: REFUSED -- the migration replay left the schema incomplete (see the UNEXPECTED lines above); the suites would judge a partially migrated database" >&2
    exit 1
  fi

  # Without the bucket, gdpr.test.ts would accept a `failed` export, the outcome this lane must catch.
  echo "== gdpr-exports bucket =="
  docker exec -i "$DB_CONTAINER" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "INSERT INTO storage.buckets (id, name, public)
          VALUES ('gdpr-exports', 'gdpr-exports', false)
          ON CONFLICT (id) DO NOTHING;" >/dev/null || {
    echo "integration-replay: REFUSED -- could not provision the private gdpr-exports bucket; the GDPR suite would silently accept a failed export" >&2
    exit 1
  }

  # PostgREST's schema cache still reflects the empty database it started on.
  echo "== reloading the PostgREST schema cache =="
  docker exec -i "$DB_CONTAINER" psql -q -U postgres -d postgres \
    -c "NOTIFY pgrst, 'reload schema';" >/dev/null
  sleep 3
}

read_stack_env() {
  local status
  if ! status="$(supa status -o env)"; then
    echo "integration-replay: HARNESS FAILURE -- supabase status failed" >&2
    exit 1
  fi
  eval "$status"
  export NEXT_PUBLIC_SUPABASE_URL="${API_URL:?supabase status gave no API_URL}"
  export NEXT_PUBLIC_SUPABASE_ANON_KEY="${ANON_KEY:?supabase status gave no ANON_KEY}"
  export SUPABASE_SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:?supabase status gave no SERVICE_ROLE_KEY}"
}

run_suites() {
  read_stack_env
  local rc=0
  echo "== tests/integration/rls =="
  RUN_RLS_TESTS=1 npx vitest run tests/integration/rls \
    --pool=forks --maxWorkers=2 || rc=$?
  echo "== tests/integration/gdpr =="
  RUN_GDPR_TESTS=1 npx vitest run tests/integration/gdpr \
    --pool=forks --maxWorkers=2 || rc=$?
  return "$rc"
}

case "${1:-all}" in
  up)
    stack_down
    TEARDOWN_STACK=1
    stack_up
    TEARDOWN_STACK=0
    read_stack_env
    echo "stack up: $NEXT_PUBLIC_SUPABASE_URL"
    echo "stop it with: $0 down"
    ;;
  down)
    stack_down
    ;;
  all)
    stack_down
    TEARDOWN_STACK=1
    stack_up
    status=0
    run_suites || status=$?
    exit "$status"
    ;;
  *)
    echo "usage: $0 [up|down|all]" >&2
    exit 2
    ;;
esac
