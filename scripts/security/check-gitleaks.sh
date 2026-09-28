#!/usr/bin/env bash
# CI gate for `.gitleaks.toml`: fails closed when gitleaks or its config is missing.
# Usage: check-gitleaks.sh --selftest | --scan   (npm run security:gitleaks runs both)

set -euo pipefail

SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONFIG="${ROOT}/.gitleaks.toml"

die() {
  echo "check-gitleaks: FAIL: $*" >&2
  exit 1
}

# No code path from here into a scan without a gitleaks binary.
require_gitleaks() {
  command -v gitleaks >/dev/null 2>&1 ||
    die "gitleaks binary not found on PATH. A missing scanner must never be treated as a clean run — install gitleaks (this gate is verified against v8.30.1) or fix PATH."
}

require_readable_file() {
  [ -f "$1" ] || die "$2: $1"
}

# Returns (does not exit) gitleaks' code so --scan and the selftest share it.
run_detect() {
  local source_dir="$1" config_path="$2"
  require_gitleaks
  require_readable_file "$config_path" "gitleaks config not found"

  local file_count
  file_count="$(find "$source_dir" -type f -not -path '*/.git/*' | wc -l | tr -d ' [:space:]')"
  local config_hash
  config_hash="$(sha256sum "$config_path" | cut -d' ' -f1 | cut -c1-12)"

  echo "check-gitleaks: $(gitleaks version 2>&1)"
  echo "check-gitleaks: config=${config_path} (sha256:${config_hash})"
  echo "check-gitleaks: scanning ${file_count} file(s) under ${source_dir}"

  local rc=0
  gitleaks detect \
    --source "$source_dir" \
    --config "$config_path" \
    --redact \
    --no-git \
    --exit-code 1 \
    -v || rc=$?
  return "$rc"
}

cmd_scan() {
  require_readable_file "$CONFIG" ".gitleaks.toml not found at repo root"
  local rc=0
  run_detect "$ROOT" "$CONFIG" || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "check-gitleaks: FAIL: gitleaks reported findings (exit ${rc}) — see the Finding/Secret/RuleID/File lines above. Do not allowlist blindly: confirm each is a documented false positive before touching .gitleaks.toml." >&2
    exit 1
  fi
  echo "check-gitleaks: clean"
}

# Selftest: a synthetic AWS key trips, a clean fixture passes, check-secrets.ts fixtures stay allowlisted
# but other secrets there do not, and a PATH without gitleaks exits 1.
cmd_selftest() {
  local failures=0
  work="$(mktemp -d)"
  trap 'rm -rf "${work:-}"' EXIT

  echo "check-gitleaks: selftest: missing-binary control (PATH without gitleaks must exit 1, never SKIPPED/0)"
  local missing_dir="${work}/no-gitleaks-on-path"
  mkdir -p "$missing_dir"
  local missing_rc=0
  ( PATH="$missing_dir"; require_gitleaks ) >"${work}/missing.log" 2>&1 && missing_rc=0 || missing_rc=$?
  if [ "$missing_rc" -ne 1 ]; then
    echo "check-gitleaks: SELFTEST FAILED: missing-binary control exited ${missing_rc}, expected 1" >&2
    cat "${work}/missing.log" >&2
    failures=$((failures + 1))
  elif ! grep -q "gitleaks binary not found on PATH" "${work}/missing.log"; then
    echo "check-gitleaks: SELFTEST FAILED: missing-binary control exited 1 but printed no clear message" >&2
    failures=$((failures + 1))
  else
    echo "check-gitleaks: selftest: missing-binary control OK (exit 1, clear message, no scan attempted)"
  fi

  require_readable_file "$CONFIG" ".gitleaks.toml not found at repo root"

  echo "check-gitleaks: selftest: positive control (synthetic AKIA-shaped secret must be flagged)"
  local dirty="${work}/dirty"
  mkdir -p "$dirty"
  cp "$CONFIG" "${dirty}/.gitleaks.toml"
  # Fake high-entropy key, split so this file never contains the token.
  local akia_prefix='AKIA'
  local akia_body='QWERTYUIOPASDFGH'
  {
    echo '# gitleaks selftest fixture: synthetic, not a real credential.'
    printf 'aws_access_key_id = "%s%s"\n' "$akia_prefix" "$akia_body"
  } >"${dirty}/planted-fixture.env"
  local dirty_rc=0
  run_detect "$dirty" "${dirty}/.gitleaks.toml" >"${work}/dirty.log" 2>&1 || dirty_rc=$?
  if [ "$dirty_rc" -ne 1 ]; then
    echo "check-gitleaks: SELFTEST FAILED: positive control did not report findings (exit ${dirty_rc}, expected 1)" >&2
    cat "${work}/dirty.log" >&2
    failures=$((failures + 1))
  elif ! grep -q "aws-access-token" "${work}/dirty.log"; then
    echo "check-gitleaks: SELFTEST FAILED: positive control exited 1 but did not report the aws-access-token rule" >&2
    cat "${work}/dirty.log" >&2
    failures=$((failures + 1))
  else
    echo "check-gitleaks: selftest: positive control OK (aws-access-token fixture flagged)"
  fi

  echo "check-gitleaks: selftest: negative control (clean fixture must pass)"
  local clean="${work}/clean"
  mkdir -p "$clean"
  cp "$CONFIG" "${clean}/.gitleaks.toml"
  cat >"${clean}/README.md" <<'EOF'
# gitleaks selftest fixture

This directory intentionally contains no secrets.
EOF
  local clean_rc=0
  run_detect "$clean" "${clean}/.gitleaks.toml" >"${work}/clean.log" 2>&1 || clean_rc=$?
  if [ "$clean_rc" -ne 0 ]; then
    echo "check-gitleaks: SELFTEST FAILED: negative control reported findings (exit ${clean_rc}, expected 0)" >&2
    cat "${work}/clean.log" >&2
    failures=$((failures + 1))
  else
    echo "check-gitleaks: selftest: negative control OK (clean fixture passed)"
  fi

  # The real check-secrets.ts path so the allowlist's `paths` match; split literals hold no token.
  local bot_body='4gaSMyqces2QkkwcsCK4'
  bot_body="${bot_body}S8SEIAmmGQiwcS8koS"
  local sk_prefix='sk_'
  local sk_body='MKOK8IIigoIs9Uqq'
  sk_body="${sk_body}040kYAUKOIacs4oAY"
  local planted_prefix='sk_'
  local planted_body='Zq4TmVrXp8LsNdHw'
  planted_body="${planted_body}Ce2RyUbAkJ6FgQ3M"
  write_fixture_table() {
    local dest="$1"
    mkdir -p "$(dirname "$dest")"
    {
      echo 'const PATTERN_FIXTURES: Record<string, string> = {'
      printf "  'Discord bot token':\n"
      printf "    'DISCORD_BOT_TOKEN=%s.selftest',\n" "$bot_body"
      printf "  'Generic bearer secret': 'API_KEY=%s%s',\n" "$sk_prefix" "$sk_body"
      echo '}'
    } >"$dest"
  }

  echo "check-gitleaks: selftest: fixture control (the two documented check-secrets.ts fixture lines must stay allowlisted)"
  local fixture_only="${work}/fixture-only"
  mkdir -p "$fixture_only"
  cp "$CONFIG" "${fixture_only}/.gitleaks.toml"
  write_fixture_table "${fixture_only}/scripts/security/check-secrets.ts"
  local fixture_rc=0
  run_detect "$fixture_only" "${fixture_only}/.gitleaks.toml" >"${work}/fixture.log" 2>&1 || fixture_rc=$?
  if [ "$fixture_rc" -ne 0 ]; then
    echo "check-gitleaks: SELFTEST FAILED: the documented check-secrets.ts fixtures were reported (exit ${fixture_rc}, expected 0)" >&2
    cat "${work}/fixture.log" >&2
    failures=$((failures + 1))
  else
    echo "check-gitleaks: selftest: fixture control OK (documented fixtures allowlisted)"
  fi

  echo "check-gitleaks: selftest: scope control (a NON-fixture secret in the same file must still be reported)"
  local scoped="${work}/scoped"
  mkdir -p "$scoped"
  cp "$CONFIG" "${scoped}/.gitleaks.toml"
  write_fixture_table "${scoped}/scripts/security/check-secrets.ts"
  printf "const api_key = '%s%s'\n" "$planted_prefix" "$planted_body" \
    >>"${scoped}/scripts/security/check-secrets.ts"
  local scoped_rc=0
  run_detect "$scoped" "${scoped}/.gitleaks.toml" >"${work}/scoped.log" 2>&1 || scoped_rc=$?
  if [ "$scoped_rc" -ne 1 ]; then
    echo "check-gitleaks: SELFTEST FAILED: a non-fixture secret in check-secrets.ts was not reported (exit ${scoped_rc}, expected 1) — the allowlist has widened to the whole file" >&2
    cat "${work}/scoped.log" >&2
    failures=$((failures + 1))
  elif ! grep -q "generic-api-key" "${work}/scoped.log"; then
    echo "check-gitleaks: SELFTEST FAILED: scope control exited 1 but did not report the generic-api-key rule" >&2
    cat "${work}/scoped.log" >&2
    failures=$((failures + 1))
  else
    echo "check-gitleaks: selftest: scope control OK (non-fixture secret still reported)"
  fi

  if [ "$failures" -gt 0 ]; then
    die "${failures} selftest control(s) failed"
  fi
  echo "check-gitleaks: selftest passed (positive, negative, fixture, scope and missing-binary controls all behaved correctly)"
}

case "${1:---scan}" in
  --selftest) cmd_selftest ;;
  --scan) cmd_scan ;;
  *)
    echo "usage: $(basename "$SCRIPT_PATH") [--selftest|--scan]" >&2
    exit 2
    ;;
esac
