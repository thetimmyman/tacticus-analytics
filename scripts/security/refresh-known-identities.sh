#!/usr/bin/env bash
# Rebuilds the local known-identities list for check-real-identities.mjs. The list is PII: written mode
# 600 outside the repo, never printed. Connection (operator supplied, read-only): TA_IDENTITY_DB_URL,
# or TA_IDENTITY_PSQL_CMD, a command that runs psql with SQL on stdin.
set -euo pipefail
umask 077

out="${TA_KNOWN_IDENTITIES_FILE:-$HOME/.cache/ta-known-identities.txt}"

if [ -n "${TA_IDENTITY_PSQL_CMD:-}" ]; then
  read -r -a psql_cmd <<<"$TA_IDENTITY_PSQL_CMD"
elif [ -n "${TA_IDENTITY_DB_URL:-}" ]; then
  psql_cmd=(psql "$TA_IDENTITY_DB_URL")
else
  echo "set TA_IDENTITY_DB_URL or TA_IDENTITY_PSQL_CMD" >&2
  exit 2
fi

sql=$(
  cat <<'SQL'
SET default_transaction_read_only = on;
BEGIN READ ONLY;
SELECT DISTINCT line FROM (
  SELECT 'id:' || id::text AS line FROM auth.users
  UNION ALL SELECT 'id:' || user_id::text FROM public.player_mapping
  UNION ALL SELECT 'id:' || player_id FROM public.player_mapping
  UNION ALL SELECT 'name:' || display_name FROM public.player_mapping
  UNION ALL SELECT 'name:' || original_display_name FROM public.player_mapping
  UNION ALL SELECT 'name:' || username FROM public.player_mapping
  UNION ALL SELECT 'name:' || discord_username FROM public.player_mapping
  UNION ALL SELECT 'id:' || guild_id FROM public.guild_config
  UNION ALL SELECT 'id:' || user_id FROM public.guild_config
  UNION ALL SELECT 'id:' || user_id::text FROM public.player_roster
  UNION ALL SELECT 'id:' || user_id FROM public.guild_war_participation
  UNION ALL SELECT 'name:' || display_name FROM public.guild_war_participation
  UNION ALL SELECT 'id:' || user_id::text FROM public.onboarding_progress
  UNION ALL SELECT 'id:' || player_id FROM public.bomb_tracking
  UNION ALL SELECT 'name:' || display_name FROM public.guild_config
  UNION ALL SELECT 'name:' || guild_code FROM public.guild_config
  UNION ALL SELECT 'name:' || display_name FROM public.clusters
  UNION ALL SELECT 'name:' || founder_name FROM public.clusters
  UNION ALL SELECT 'name:' || cluster_code FROM public.clusters
  UNION ALL SELECT 'id:' || discord_user_id FROM public.player_mapping
  UNION ALL SELECT 'id:' || discord_server_id FROM public.clusters
  UNION ALL SELECT 'id:' || bomb_alert_role_id FROM public.guild_config
  UNION ALL SELECT 'id:' || herald_default_role_id FROM public.guild_config
  UNION ALL SELECT 'id:' || substring(webhook_url from '/webhooks/([0-9]+)/') FROM public.webhook_config
  UNION ALL SELECT 'id:' || substring(discord_webhook_url from '/webhooks/([0-9]+)/') FROM public.guild_config
  UNION ALL SELECT 'id:' || substring(bomb_alert_webhook_url from '/webhooks/([0-9]+)/') FROM public.guild_config
) AS identities
WHERE line IS NOT NULL
  AND line !~ E'[\\r\\n]'
  AND btrim(split_part(line, ':', 2)) <> '';
COMMIT;
SQL
)

mkdir -p "$(dirname "$out")"
tmp="$(mktemp "$out.XXXXXX")"
trap 'rm -f "$tmp" "$tmp.clean"' EXIT
printf '%s\n' "$sql" |
  "${psql_cmd[@]}" -X -q -A -t -v ON_ERROR_STOP=1 >"$tmp"
# Drop psql's command tags (SET, BEGIN, COMMIT) if a wrapper echoes them.
grep -E '^(id|name):' "$tmp" >"$tmp.clean" || true
mv "$tmp.clean" "$tmp"
[ -s "$tmp" ] || {
  echo "no identities returned; keeping the previous file" >&2
  exit 1
}
chmod 600 "$tmp"
mv "$tmp" "$out"
trap - EXIT
echo "wrote $(wc -l <"$out") identities to $out"
