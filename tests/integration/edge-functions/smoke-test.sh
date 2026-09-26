#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT_DIR"

is_placeholder() {
  local value="$1"
  [[ -z "$value" ]] && return 0
  [[ "$value" == *placeholder* ]] && return 0
  [[ "$value" == unit-test-* || "$value" == test-* ]] && return 0
  [[ "$value" == your_* || "$value" == your-* ]] && return 0
  return 1
}

is_local_url() {
  local value="$1"
  [[ -z "$value" ]] && return 1
  local host
  host="$(node -e "try{console.log(new URL(process.argv[1]).hostname)}catch{process.exit(1)}" "$value" 2>/dev/null)" || return 1
  [[ "$host" == "localhost" || "$host" == "127.0.0.1" || "$host" == "::1" ]]
}

should_override() {
  local key="$1"
  local current="$2"
  if is_placeholder "$current"; then
    return 0
  fi
  if [[ "$key" == "SUPABASE_URL" || "$key" == "NEXT_PUBLIC_SUPABASE_URL" ]]; then
    if ! is_local_url "$current"; then
      return 0
    fi
  fi
  return 1
}

apply_env_value() {
  local key="$1"
  local value="$2"
  local current="${!key:-}"
  if should_override "$key" "$current" && [[ -n "$value" ]]; then
    export "$key=$value"
  fi
}

load_env_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  local output
  output="$(ENV_FILE="$file" node - <<'NODE'
const fs = require('fs')
const dotenv = require('dotenv')
const file = process.env.ENV_FILE
if (!file || !fs.existsSync(file)) process.exit(0)
const data = dotenv.parse(fs.readFileSync(file))
const keys = [
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'ENCRYPTION_KEY',
  'SMOKE_TEST_GUILD_CODE',
  'FUNCTIONS_URL'
]
for (const key of keys) {
  if (data[key]) {
    console.log(`${key}=${data[key]}`)
  }
}
NODE
)"
  [[ -z "$output" ]] && return 0
  while IFS= read -r line; do
    line="${line%$'\r'}"
    [[ -z "$line" ]] && continue
    local key="${line%%=*}"
    local value="${line#*=}"
    value="${value%$'\r'}"
    apply_env_value "$key" "$value"
  done <<< "$output"
}

load_supabase_status() {
  local status_output
  status_output="$(npx supabase status -o env 2>/dev/null || true)"
  [[ -z "$status_output" ]] && return 1
  while IFS= read -r line; do
    local trimmed
    trimmed="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [[ -z "$trimmed" || "$trimmed" == \#* ]] && continue
    local key="${trimmed%%=*}"
    local value="${trimmed#*=}"
    value="${value%\"}"
    value="${value#\"}"
    case "$key" in
      API_URL|SUPABASE_URL)
        apply_env_value "SUPABASE_URL" "$value"
        apply_env_value "NEXT_PUBLIC_SUPABASE_URL" "$value"
        ;;
      ANON_KEY|SUPABASE_ANON_KEY)
        apply_env_value "SUPABASE_ANON_KEY" "$value"
        apply_env_value "NEXT_PUBLIC_SUPABASE_ANON_KEY" "$value"
        ;;
      SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY)
        apply_env_value "SUPABASE_SERVICE_ROLE_KEY" "$value"
        ;;
    esac
  done <<< "$status_output"
}

load_supabase_status || true
load_env_file ".env.local"
load_env_file ".env"
load_env_file ".env.local.backup"

SUPABASE_URL="${SUPABASE_URL:-${NEXT_PUBLIC_SUPABASE_URL:-http://localhost:54321}}"
SUPABASE_URL="${SUPABASE_URL%/}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}}"
ENCRYPTION_KEY="${ENCRYPTION_KEY:-}"
SMOKE_TEST_GUILD_CODE="${SMOKE_TEST_GUILD_CODE:-}"
FUNCTIONS_URL="${FUNCTIONS_URL:-$SUPABASE_URL}"

if ! is_local_url "$SUPABASE_URL"; then
  echo "SUPABASE_URL must point at a local Supabase instance (localhost/127.0.0.1)."
  exit 1
fi

if [[ -z "$SUPABASE_SERVICE_ROLE_KEY" ]]; then
  echo "Missing SUPABASE_SERVICE_ROLE_KEY. Export it before running this script."
  exit 1
fi

if [[ -z "$ENCRYPTION_KEY" ]]; then
  echo "Missing ENCRYPTION_KEY. Export it before running this script."
  exit 1
fi

if [[ -z "$SMOKE_TEST_GUILD_CODE" ]]; then
  echo "Missing SMOKE_TEST_GUILD_CODE. Provide a guild code with seeded data."
  exit 1
fi

ENV_FILE="$(mktemp)"
LOG_FILE="$(mktemp)"
ENV_FILE_ARG="$ENV_FILE"
if command -v cygpath >/dev/null 2>&1; then
  ENV_FILE_ARG="$(cygpath -w "$ENV_FILE")"
fi

cleanup() {
  if [[ -n "${SERVE_PID:-}" ]] && kill -0 "$SERVE_PID" 2>/dev/null; then
    kill "$SERVE_PID" >/dev/null 2>&1 || true
  fi
  rm -f "$ENV_FILE" "$LOG_FILE"
}
trap cleanup EXIT

cat > "$ENV_FILE" <<EOF
SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY
ENCRYPTION_KEY=$ENCRYPTION_KEY
EOF

echo "Starting Supabase edge runtime at ${FUNCTIONS_URL}..."
npx supabase functions serve --env-file "$ENV_FILE_ARG" --no-verify-jwt >"$LOG_FILE" 2>&1 &
SERVE_PID=$!

wait_for_functions() {
  local attempts=30
  local delay=1

  for ((i=1; i<=attempts; i++)); do
    if curl -sS --max-time 2 "${FUNCTIONS_URL}" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay"
  done

  echo "Timed out waiting for Supabase edge runtime at ${FUNCTIONS_URL}"
  echo "Tail of serve logs:"
  tail -n 50 "$LOG_FILE" || true
  exit 1
}

wait_for_functions

check_endpoint() {
  local name="$1"
  local payload="$2"
  local attempts=5
  local delay=2

  for ((i=1; i<=attempts; i++)); do
    local response status body curl_status=0
    response="$(curl -sS -w '\n%{http_code}' \
      -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
      -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
      -H "Content-Type: application/json" \
      -X POST \
      -d "$payload" \
      "${FUNCTIONS_URL}/functions/v1/${name}")" || curl_status=$?

    if [[ "$curl_status" -ne 0 ]]; then
      if [[ "$i" -lt "$attempts" ]]; then
        sleep "$delay"
        continue
      fi
      echo "Failed to reach ${name} (curl exit ${curl_status})"
      echo "Tail of serve logs:"
      tail -n 50 "$LOG_FILE" || true
      exit 1
    fi

    status="$(echo "$response" | tail -n 1)"
    body="$(echo "$response" | head -n -1)"

    if [[ "$status" == "200" ]]; then
      node -e "JSON.parse(require('fs').readFileSync(0,'utf8'))" <<<"$body" >/dev/null
      echo "OK: ${name}"
      return 0
    fi

    if [[ "$status" == "502" || "$status" == "503" ]] && [[ "$i" -lt "$attempts" ]]; then
      sleep "$delay"
      continue
    fi

    echo "Expected 200 from ${name}, got ${status}"
    echo "$body"
    echo "Tail of serve logs:"
    tail -n 50 "$LOG_FILE" || true
    exit 1
  done
}

check_endpoint "sync-modular-workflow" "{\"guild_code\":\"${SMOKE_TEST_GUILD_CODE}\"}"
check_endpoint "boss-assignment-solver" "{\"guild_code\":\"${SMOKE_TEST_GUILD_CODE}\",\"mode\":\"current\",\"min_attacks\":20,\"selected_bosses\":[{\"boss_name\":\"Boss Alpha\",\"rarity\":\"Legendary\",\"set\":0,\"encounter_id\":0}]}"

echo "Edge function smoke tests passed."
