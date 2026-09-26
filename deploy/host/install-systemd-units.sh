#!/usr/bin/env bash
# Idempotent root installer for this repo's host units: copies deploy/host/systemd/ units and scripts,
# reloads systemd and enables the timers. Never touches the cluster or installs a credential.
# Units run as the checkout's owner, not root: they execute checkout code that any writer of it controls.
# Usage: sudo deploy/host/install-systemd-units.sh [--dry-run]
# Env: PROJECT_ROOT (checkout the units point at; default: this script's), RUN_USER (must own PROJECT_ROOT),
#   RUN_GROUP, KUBECONFIG_PATH (default: RUN_USER's ~/.kube/config, or the k3s config for root).
set -euo pipefail

SOURCE_ROOT="$(cd -- "$(dirname -- "$0")/../.." 2>/dev/null && pwd || true)"
PROJECT_ROOT="${PROJECT_ROOT:-${SOURCE_ROOT:-}}"
SYSTEMD_DST="${SYSTEMD_DST:-/etc/systemd/system}"
BIN_DST="${BIN_DST:-/usr/local/bin}"
# Prefixed because the host is shared with other projects' units.
BIN_PREFIX="tacticus-"

DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --help | -h)
      grep -E '^# ' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "[ERROR] unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

log() { printf '[install-systemd-units] %s\n' "$*"; }

# These lists are the rebuild contract: an unlisted file does not come back.
UNITS=(
  tacticus-deploy-drift-check.service
  tacticus-deploy-drift-check.timer
)
TIMERS_TO_ENABLE=(
  tacticus-deploy-drift-check.timer
)
SCRIPTS=(
  deploy-drift-check.sh
)

# PROJECT_ROOT without a pin would make the timer compare nothing every day.
for _root in SOURCE_ROOT PROJECT_ROOT; do
  _value="${!_root}"
  if [[ -z "$_value" || ! -f "$_value/deploy/tacticus.pin.json" ]]; then
    echo "[ERROR] $_root ('${_value:-<empty>}') is not a checkout of this repository (no deploy/tacticus.pin.json)." >&2
    exit 1
  fi
done

SRC_UNITS="$SOURCE_ROOT/deploy/host/systemd"
SRC_BIN="$SOURCE_ROOT/deploy/host"

if [[ ! -d "$SRC_UNITS" ]]; then
  echo "[ERROR] unit source dir not found: $SRC_UNITS" >&2
  exit 1
fi

if [[ "$DRY_RUN" != true && "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "[ERROR] run as root (sudo), or pass --dry-run." >&2
  exit 1
fi

# Run user: whoever owns the checkout, the only account running it grants nothing.
OWNER_UID="$(stat -c '%u' "$PROJECT_ROOT")"
OWNER_USER="$(stat -c '%U' "$PROJECT_ROOT")"
OWNER_GROUP="$(stat -c '%G' "$PROJECT_ROOT")"
if [[ "$OWNER_USER" == "UNKNOWN" || -z "$OWNER_USER" ]]; then
  echo "[ERROR] '$PROJECT_ROOT' is owned by uid $OWNER_UID, which maps to no account on this host; refusing to guess who the unit should run as." >&2
  exit 1
fi

RUN_USER="${RUN_USER:-$OWNER_USER}"
RUN_GROUP="${RUN_GROUP:-$OWNER_GROUP}"

if ! id -u "$RUN_USER" >/dev/null 2>&1; then
  echo "[ERROR] RUN_USER '$RUN_USER' does not exist on this host." >&2
  exit 1
fi
# An override must name the owner's account, or checkout code would run as someone who does not control it.
if [[ "$(id -u "$RUN_USER")" != "$OWNER_UID" ]]; then
  echo "[ERROR] RUN_USER '$RUN_USER' (uid $(id -u "$RUN_USER")) is not the owner of '$PROJECT_ROOT' (uid $OWNER_UID)." >&2
  echo "        The unit executes the renderer out of that checkout; running it as a different account would hand whoever can write the checkout this unit's privileges on a timer." >&2
  echo "        Either chown the checkout, or point PROJECT_ROOT at the tree the intended account owns." >&2
  exit 1
fi
for _v in RUN_USER RUN_GROUP; do
  if [[ ! "${!_v}" =~ ^[A-Za-z_][A-Za-z0-9_.-]*$ ]]; then
    echo "[ERROR] $_v ('${!_v}') is not a plain account name; systemd's User=/Group= take no quoting." >&2
    exit 1
  fi
done

if [[ -n "${KUBECONFIG_PATH:-}" ]]; then
  KUBECONFIG_FILE="$KUBECONFIG_PATH"
elif [[ "$OWNER_UID" == "0" ]]; then
  KUBECONFIG_FILE="/etc/rancher/k3s/k3s.yaml"
else
  _home="$(getent passwd "$RUN_USER" | cut -d: -f6)"
  KUBECONFIG_FILE="${_home:-/home/$RUN_USER}/.kube/config"
fi

NAMESPACE="$(
  node -e '
    const fs = require("node:fs");
    const v = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).namespace;
    process.stdout.write(v == null ? "" : String(v));
  ' "$PROJECT_ROOT/deploy/tacticus.pin.json" 2>/dev/null || true
)"

# Prove the read-only credential first: a unit that compares nothing looks like a watchdog and is not one.
check_kubeconfig() {
  if [[ ! -f "$KUBECONFIG_FILE" ]]; then
    echo "[ERROR] kubeconfig '$KUBECONFIG_FILE' does not exist. Set KUBECONFIG_PATH to one the '$RUN_USER' account can read." >&2
    return 1
  fi
  if [[ "$DRY_RUN" == true ]]; then
    log "DRY-RUN would verify '$RUN_USER' can read $KUBECONFIG_FILE and list namespace '${NAMESPACE:-<unset>}'"
    return 0
  fi
  if ! runuser -u "$RUN_USER" -- test -r "$KUBECONFIG_FILE"; then
    echo "[ERROR] '$RUN_USER' cannot read kubeconfig '$KUBECONFIG_FILE'." >&2
    echo "        Do NOT copy root's cluster-admin kubeconfig into a user home to work around this — give the account a get/list-only kubeconfig and pass it as KUBECONFIG_PATH." >&2
    return 1
  fi
  if ! runuser -u "$RUN_USER" -- env KUBECONFIG="$KUBECONFIG_FILE" kubectl get ns "${NAMESPACE:-default}" >/dev/null 2>&1; then
    echo "[ERROR] '$RUN_USER' cannot read namespace '${NAMESPACE:-default}' with '$KUBECONFIG_FILE'; every timed run would report INCONCLUSIVE." >&2
    return 1
  fi
  log "verified: '$RUN_USER' can read namespace '${NAMESPACE:-default}' with $KUBECONFIG_FILE (get/list is all this needs)"
  return 0
}
check_kubeconfig

log "SOURCE_ROOT  = $SOURCE_ROOT (artifacts read from here)"
log "PROJECT_ROOT = $PROJECT_ROOT (installed units will point here)"
log "RUN_USER     = $RUN_USER:$RUN_GROUP (owner of PROJECT_ROOT, uid $OWNER_UID)"
log "KUBECONFIG   = $KUBECONFIG_FILE"

# Root-owned in a root-only directory so the run user cannot rewrite its own job.
for rel in "${SCRIPTS[@]}"; do
  src="$SRC_BIN/$rel"
  dst="$BIN_DST/$BIN_PREFIX$(basename "$rel")"
  if [[ ! -f "$src" ]]; then
    echo "[ERROR] missing script source: $src" >&2
    exit 1
  fi
  if [[ "$DRY_RUN" == true ]]; then
    log "DRY-RUN would install $src -> $dst (0755 root:root)"
  else
    install -m 0755 -o root -g root "$src" "$dst"
    log "installed $dst"
  fi
done

# Values land inside `Environment="KEY=..."`, so escape `"` and `\`; systemd truncates at unescaped whitespace.
systemd_escape_value() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

for _v in PROJECT_ROOT KUBECONFIG_FILE; do
  if [[ "${!_v}" == *$'\n'* ]]; then
    echo "[ERROR] $_v contains a newline, which cannot be expressed in a systemd Environment= assignment." >&2
    exit 1
  fi
done

PROJECT_ROOT_ESC="$(systemd_escape_value "$PROJECT_ROOT")"
KUBECONFIG_ESC="$(systemd_escape_value "$KUBECONFIG_FILE")"

render_unit() {
  # `|` is the sed delimiter, so a value containing one fails loudly.
  local src="$1"
  for _val in "$PROJECT_ROOT_ESC" "$KUBECONFIG_ESC" "$RUN_USER" "$RUN_GROUP"; do
    if [[ "$_val" == *"|"* ]]; then
      echo "[ERROR] a substituted value contains '|', which the unit substitution uses as its delimiter." >&2
      exit 1
    fi
  done
  sed \
    -e "s|@PROJECT_ROOT@|$PROJECT_ROOT_ESC|g" \
    -e "s|@KUBECONFIG@|$KUBECONFIG_ESC|g" \
    -e "s|@RUN_USER@|$RUN_USER|g" \
    -e "s|@RUN_GROUP@|$RUN_GROUP|g" \
    "$src"
}

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

for unit in "${UNITS[@]}"; do
  src="$SRC_UNITS/$unit"
  if [[ ! -f "$src" ]]; then
    echo "[ERROR] missing unit source: $src" >&2
    exit 1
  fi
  render_unit "$src" >"$STAGE/$unit"
  # An unsubstituted placeholder would install a unit that silently checks nothing.
  if grep -q '@[A-Z_]\+@' "$STAGE/$unit"; then
    echo "[ERROR] a placeholder survived substitution in $unit:" >&2
    grep -n '@[A-Z_]\+@' "$STAGE/$unit" >&2
    exit 1
  fi
done

# Parse rendered units with systemd itself; any diagnostic rejects, as systemd-analyze exits 0 on a bad Environment=.
if command -v systemd-analyze >/dev/null 2>&1; then
  verify_rc=0
  systemd-analyze verify "$STAGE"/*.service "$STAGE"/*.timer 2>"$STAGE/verify.raw" || verify_rc=$?
  # verify also reports on dependency units; keep only lines about ours.
  awk -v stage="$STAGE/" -v units="${UNITS[*]}" '
    BEGIN { n = split(units, U, " "); for (i = 1; i <= n; i++) keep[U[i]] = 1 }
    index($0, stage) == 1 { print; next }
    { p = index($0, ":"); if (p > 0 && (substr($0, 1, p - 1) in keep)) print }
  ' "$STAGE/verify.raw" >"$STAGE/verify.err"
  if [[ "$DRY_RUN" == true ]]; then
    # A dry run has not installed the ExecStart binary yet; ignore that complaint only.
    grep -v 'is not executable: No such file or directory' "$STAGE/verify.err" >"$STAGE/verify.filtered" || true
    mv "$STAGE/verify.filtered" "$STAGE/verify.err"
    verify_rc=0
  fi
  if [[ "$verify_rc" -ne 0 || -s "$STAGE/verify.err" ]]; then
    echo "[ERROR] systemd-analyze verify rejected the rendered units (exit $verify_rc); nothing was installed." >&2
    sed 's/^/    /' "$STAGE/verify.err" >&2
    exit 1
  fi
  log "systemd-analyze verify: rendered units parse cleanly, with no diagnostics"
else
  log "WARNING: systemd-analyze not found; rendered units were not parse-checked"
fi

for unit in "${UNITS[@]}"; do
  dst="$SYSTEMD_DST/$unit"
  if [[ "$DRY_RUN" == true ]]; then
    log "DRY-RUN would install rendered $unit -> $dst"
    continue
  fi
  install -m 0644 -o root -g root "$STAGE/$unit" "$dst"
  log "installed $dst"
done

if [[ "$DRY_RUN" == true ]]; then
  log "DRY-RUN would: systemctl daemon-reload; systemctl enable --now ${TIMERS_TO_ENABLE[*]}"
  exit 0
fi

systemctl daemon-reload
log "daemon-reload done"

for timer in "${TIMERS_TO_ENABLE[@]}"; do
  systemctl enable --now "$timer"
  log "enabled + started $timer"
done

log "done."
