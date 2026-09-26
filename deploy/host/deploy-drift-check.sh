#!/usr/bin/env bash
# Read-only drift check of live `tacticus` objects against deploy/tacticus.pin.json and its rendered
# manifests: compares declared fields to `kubectl get -o json`, so no patch rights are needed. Always exits 0.
# The renderer is checkout code, so it runs only when the effective user owns the checkout.
# Usage: deploy-drift-check.sh [--selftest | --help]
# Env: PROJECT_ROOT (default: this script's checkout), NAMESPACE (default: from the pin), KUBECTL.
set -uo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  grep -E '^# ' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

# Declared-field comparator, inlined so the check stays one installed file.
read -r -d '' NODE_COMPARE <<'NODEJS'
const fs = require("node:fs");
const want = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const got = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const diffs = [];
function walk(path, w, g) {
  if (w === null || typeof w !== "object") {
    // String()-compare: YAML `'false'` and JSON false, 9000 and "9000" are the
    // same declaration to the API server and must not read as drift.
    if (String(w) !== String(g)) {
      diffs.push(`${path}: declared ${JSON.stringify(w)}, live ${JSON.stringify(g)}`);
    }
    return;
  }
  if (Array.isArray(w)) {
    if (!Array.isArray(g)) {
      diffs.push(`${path}: declared a list, live ${JSON.stringify(g)}`);
      return;
    }
    if (w.length !== g.length) {
      diffs.push(`${path}: declared ${w.length} entries, live has ${g.length}`);
      return;
    }
    w.forEach((x, i) => walk(`${path}[${i}]`, x, g[i]));
    return;
  }
  if (g === null || typeof g !== "object" || Array.isArray(g)) {
    diffs.push(`${path}: declared an object, live ${JSON.stringify(g)}`);
    return;
  }
  for (const k of Object.keys(w)) {
    if (!(k in g)) {
      diffs.push(`${path}.${k}: declared ${JSON.stringify(w[k])}, absent from live`);
      continue;
    }
    walk(`${path}.${k}`, w[k], g[k]);
  }
}
walk(`${want.kind}/${want.metadata.name}`, want, got);
process.stdout.write(diffs.join("\n"));
process.exit(diffs.length ? 1 : 0);
NODEJS

read -r -d '' NODE_IDENT <<'NODEJS'
const d = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
process.stdout.write(`${d.kind} ${d.metadata.name}`);
NODEJS

read -r -d '' NODE_SELECTOR <<'NODEJS'
const d = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
const m = (d.spec && d.spec.selector && d.spec.selector.matchLabels) || {};
process.stdout.write(
  Object.entries(m)
    .map(([k, v]) => `${k}=${v}`)
    .join(","),
);
NODEJS

# A patched template shows the new image while the old ReplicaSet still serves, so check running pods.
read -r -d '' NODE_ROLLOUT <<'NODEJS'
const fs = require("node:fs");
const dep = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const podsRaw = fs.readFileSync(process.argv[2], "utf8").trim();
const pods = podsRaw ? JSON.parse(podsRaw).items || [] : [];
const expected = process.argv[3] || "";
const problems = [];
const st = dep.status || {};
const want = dep.spec && dep.spec.replicas != null ? dep.spec.replicas : 1;

if (dep.metadata.generation !== st.observedGeneration) {
  problems.push(
    `the controller has NOT observed the current spec (metadata.generation ${dep.metadata.generation} != status.observedGeneration ${st.observedGeneration}) — the pod template is a wish, not a description of what runs`,
  );
}
for (const [field, label] of [
  ["updatedReplicas", "updated to the current template"],
  ["readyReplicas", "ready"],
  ["availableReplicas", "available"],
]) {
  const n = st[field] || 0;
  if (n !== want) {
    problems.push(`${n}/${want} replicas ${label} (status.${field}) — the rollout has not completed`);
  }
}
const cond = Object.fromEntries((st.conditions || []).map((c) => [c.type, c]));
for (const type of ["Available", "Progressing"]) {
  const c = cond[type];
  if (!c) {
    problems.push(`Deployment condition ${type} is absent`);
  } else if (c.status !== "True") {
    problems.push(`Deployment condition ${type}=${c.status} (${c.reason || "no reason"}): ${c.message || ""}`);
  }
}
const ready = pods.filter(
  (p) =>
    p.status &&
    p.status.phase === "Running" &&
    (p.status.containerStatuses || []).length > 0 &&
    (p.status.containerStatuses || []).every((c) => c.ready),
);
if (ready.length === 0) {
  problems.push("no ready Running pod matches this Deployment's selector — nothing is serving the pinned image");
} else if (expected) {
  for (const p of ready) {
    for (const c of p.spec.containers || []) {
      if (c.image !== expected) {
        problems.push(
          `ready pod ${p.metadata.name} serves \`${c.image}\`, not the pinned \`${expected}\` — an older ReplicaSet is still taking traffic`,
        );
      }
    }
  }
}
process.stdout.write(problems.join("\n"));
process.exit(problems.length ? 1 : 0);
NODEJS

WORK="$(mktemp -d "${TMPDIR:-/tmp}/tacticus-drift.XXXXXX")" || {
  echo "[deploy-drift-check] FATAL: cannot create a working directory" >&2
  exit 1
}
trap 'rm -rf "$WORK"' EXIT

drift=()
log() { printf '[deploy-drift-check] %s\n' "$*"; }
add_drift() { drift+=("$1"); }

# Returns 0 clean, 1 drift, 2 inconclusive; echoes the differences.
compare_declared_object() {
  local declared_json="$1" kind="$2" name="$3" live_json="$WORK/live.json" err="$WORK/live.err"
  if ! "$KUBECTL" -n "$NAMESPACE" get "$kind" "$name" -o json >"$live_json" 2>"$err"; then
    if grep -qi 'not found' "$err"; then
      printf '%s/%s: declared by this repository but ABSENT from namespace `%s`' "$kind" "$name" "$NAMESPACE"
      return 1
    fi
    printf 'could not read live %s/%s: %s' "$kind" "$name" "$(head -3 "$err" | tr '\n' ' ')"
    return 2
  fi
  local out
  out="$(node -e "$NODE_COMPARE" "$declared_json" "$live_json" 2>"$err")"
  local rc=$?
  if ((rc > 1)); then
    printf 'comparator failed for %s/%s: %s' "$kind" "$name" "$(head -3 "$err" | tr '\n' ' ')"
    return 2
  fi
  printf '%s' "$out"
  return "$rc"
}

# --selftest proves the comparator without a cluster (run by `npm run tooling:check`).
selftest() {
  local rc=0 out cmp_rc
  local declared="$WORK/st-declared.json" live="$WORK/st-live.json"

  cat >"$declared" <<'JSON'
{
  "apiVersion": "apps/v1",
  "kind": "Deployment",
  "metadata": { "name": "example", "namespace": "tacticus", "labels": { "app": "example" } },
  "spec": {
    "replicas": 2,
    "template": {
      "spec": {
        "containers": [
          { "name": "app", "image": "ghcr.io/x/y:t@sha256:d", "env": [{ "name": "VERIFY_JWT", "value": "false" }] }
        ]
      }
    }
  }
}
JSON

  assert() {
    local label="$1" want_rc="$2" want_text="${3:-}"
    out="$(node -e "$NODE_COMPARE" "$declared" "$live")"
    cmp_rc=$?
    if [[ "$cmp_rc" != "$want_rc" ]]; then
      echo "SELFTEST FAIL: $label — expected exit $want_rc, got $cmp_rc ($out)" >&2
      rc=1
      return
    fi
    if [[ -n "$want_text" && "$out" != *"$want_text"* ]]; then
      echo "SELFTEST FAIL: $label — expected the report to mention '$want_text', got: $out" >&2
      rc=1
      return
    fi
    echo "selftest: $label — OK"
  }

  # Positive control: undeclared server defaults must not read as drift.
  cat >"$live" <<'JSON'
{
  "apiVersion": "apps/v1",
  "kind": "Deployment",
  "metadata": {
    "name": "example", "namespace": "tacticus", "labels": { "app": "example" },
    "generation": 7, "creationTimestamp": "2026-01-01T00:00:00Z"
  },
  "spec": {
    "replicas": 2,
    "progressDeadlineSeconds": 600,
    "template": {
      "spec": {
        "dnsPolicy": "ClusterFirst",
        "containers": [
          {
            "name": "app", "image": "ghcr.io/x/y:t@sha256:d", "terminationMessagePath": "/dev/termination-log",
            "env": [{ "name": "VERIFY_JWT", "value": "false" }]
          }
        ]
      }
    }
  },
  "status": { "readyReplicas": 2 }
}
JSON
  assert "a live object carrying every declared field is clean" 0

  # Negative controls: each must fire, or the positive control proves nothing.
  sed 's/"replicas": 2,/"replicas": 5,/' "$WORK/st-live.json" >"$WORK/st-live.tmp" && mv "$WORK/st-live.tmp" "$live"
  assert "a patched replica count is drift" 1 "spec.replicas"

  sed 's/"replicas": 5,/"replicas": 2,/; s|ghcr.io/x/y:t@sha256:d|ghcr.io/x/y:OTHER@sha256:d|' "$live" >"$WORK/st-live.tmp" && mv "$WORK/st-live.tmp" "$live"
  assert "an image rolled outside the pin is drift" 1 "image"

  sed 's|ghcr.io/x/y:OTHER@sha256:d|ghcr.io/x/y:t@sha256:d|; s|"env": \[{ "name": "VERIFY_JWT", "value": "false" }\]|"env": [{ "name": "VERIFY_JWT", "value": "false" }, { "name": "SNEAKED_IN", "value": "1" }]|' "$live" >"$WORK/st-live.tmp" && mv "$WORK/st-live.tmp" "$live"
  assert "an env var ADDED to the live object is drift (list length)" 1 "entries"

  node -e '
    const fs = require("node:fs");
    const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    delete d.spec.replicas;
    fs.writeFileSync(process.argv[1], JSON.stringify(d));
  ' "$live"
  assert "a declared field deleted from the live object is drift" 1 "replicas"

  if [[ "$rc" == 0 ]]; then
    echo "selftest: all comparator controls behaved — OK"
  fi
  return "$rc"
}

# The installed copy has no checkout around it, so the unit passes PROJECT_ROOT.
default_project_root() {
  local self_root
  self_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)" || self_root=""
  # Not `git rev-parse`: it walks up and could resolve a nested copy to the wrong repo.
  if [[ -n "$self_root" && -e "$self_root/deploy/tacticus.pin.json" ]]; then
    printf '%s\n' "$self_root"
    return 0
  fi
  git rev-parse --show-toplevel 2>/dev/null && return 0
  return 1
}

PROJECT_ROOT="${PROJECT_ROOT:-$(default_project_root || true)}"
KUBECTL="${KUBECTL:-kubectl}"
PIN_FILE="$PROJECT_ROOT/deploy/tacticus.pin.json"
RENDERER="$PROJECT_ROOT/scripts/release/render-edge-manifests.sh"
DEPLOYMENT_NAME="supabase-edge-functions"

if [[ "${1:-}" == "--selftest" ]]; then
  selftest
  exit $?
fi

# An unusable checkout is reported as drift, never as clean.
log "check: is \`$PROJECT_ROOT\` a checkout of this repository?"
if [[ -z "$PROJECT_ROOT" || ! -f "$PIN_FILE" ]]; then
  add_drift "PROJECT-ROOT NOT A CHECKOUT: \`$PIN_FILE\` is absent, so NOTHING was compared — live state is UNKNOWN here, not clean. Point PROJECT_ROOT at a checkout of this repository."
else
  if head_sha="$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null)"; then
    log "  OK: \`$PROJECT_ROOT\` is a git checkout at \`$head_sha\`."
  else
    log "  NOTE: \`$PROJECT_ROOT\` has the expected files but no readable git repository; comparisons still run against the files on disk."
  fi
fi

# Refuse to execute checkout code unless we own the checkout (see header).
may_execute_renderer=false
checkout_owner_uid=""
if [[ -n "$PROJECT_ROOT" && -d "$PROJECT_ROOT" ]]; then
  checkout_owner_uid="$(stat -c '%u' "$PROJECT_ROOT" 2>/dev/null || true)"
fi
if [[ -z "$checkout_owner_uid" ]]; then
  log "  NOTE: cannot determine the owner of \`$PROJECT_ROOT\`; the renderer will not be executed."
elif [[ "$checkout_owner_uid" == "$(id -u)" ]]; then
  may_execute_renderer=true
else
  log "  NOTE: running as uid $(id -u) but \`$PROJECT_ROOT\` is owned by uid $checkout_owner_uid; the renderer will not be executed."
fi

read_pin_field() {
  node -e '
    const fs = require("node:fs");
    const v = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))[process.argv[2]];
    process.stdout.write(v == null ? "" : String(v));
  ' "$PIN_FILE" "$1" 2>/dev/null
}

NAMESPACE="${NAMESPACE:-}"
if [[ -z "$NAMESPACE" && -f "$PIN_FILE" ]]; then
  NAMESPACE="$(read_pin_field namespace)"
fi

kubectl_ok=false
if [[ -n "$NAMESPACE" ]] && command -v "$KUBECTL" >/dev/null 2>&1; then
  if "$KUBECTL" -n "$NAMESPACE" get ns "$NAMESPACE" >/dev/null 2>&1 \
    || "$KUBECTL" get ns "$NAMESPACE" >/dev/null 2>&1; then
    kubectl_ok=true
  fi
fi

expected=""
if [[ -f "$PIN_FILE" ]]; then
  pin_image="$(read_pin_field image)"
  pin_tag="$(read_pin_field tag)"
  pin_digest="$(read_pin_field digest)"
  if [[ -n "$pin_image" && -n "$pin_tag" && -n "$pin_digest" && "$pin_digest" != "null" ]]; then
    expected="${pin_image}:${pin_tag}@${pin_digest}"
  fi
fi

log "check: live edge-runtime image vs \`deploy/tacticus.pin.json\`"
if [[ ! -f "$PIN_FILE" ]]; then
  log "  SKIPPED: no pin file (already reported above)."
elif [[ "$kubectl_ok" != true ]]; then
  add_drift "image check INCONCLUSIVE: no usable kubectl/namespace (\`$KUBECTL\`, namespace \`${NAMESPACE:-<unset>}\`), so the live image was NOT read — it is UNKNOWN, not matching."
elif [[ -z "$expected" ]]; then
  add_drift "pin \`deploy/tacticus.pin.json\` is incomplete (image/tag/digest) — no CI build has stamped it, so there is nothing to compare the live image against."
else
  live="$("$KUBECTL" -n "$NAMESPACE" get deployment "$DEPLOYMENT_NAME" \
    -o jsonpath='{.spec.template.spec.containers[*].image}' 2>/dev/null)"
  if [[ -z "$live" ]]; then
    add_drift "Deployment/$DEPLOYMENT_NAME in namespace \`$NAMESPACE\` has no readable image (missing Deployment, or no kubeconfig access) — the live image is UNKNOWN, not matching."
  elif [[ "$live" == "$expected" ]]; then
    log "  OK: the pod template's image matches the pin (\`$expected\`)."
  else
    add_drift "IMAGE DRIFT: live Deployment/$DEPLOYMENT_NAME runs \`$live\` but \`deploy/tacticus.pin.json\` pins \`$expected\`. Either a roll never reached the cluster, or the cluster was rolled outside this repo."
  fi
fi

# `.spec.template` matches the pin as soon as `kubectl set image` returns, even if no pod becomes ready.
log "check: the rollout landed (Deployment status and the images ready pods serve)"
if [[ "$kubectl_ok" != true ]]; then
  add_drift "rollout check INCONCLUSIVE: no usable kubectl/namespace, so rollout state was NOT read — it is UNKNOWN, not healthy."
else
  dep_json="$WORK/deployment.json"
  if ! "$KUBECTL" -n "$NAMESPACE" get deployment "$DEPLOYMENT_NAME" -o json >"$dep_json" 2>"$WORK/dep.err"; then
    add_drift "rollout check INCONCLUSIVE: could not read Deployment/$DEPLOYMENT_NAME in namespace \`$NAMESPACE\` — $(head -3 "$WORK/dep.err" | tr '\n' ' ')"
  else
    selector="$(node -e "$NODE_SELECTOR" "$dep_json" 2>/dev/null)"
    pods_json="$WORK/pods.json"
    : >"$pods_json"
    if [[ -n "$selector" ]]; then
      "$KUBECTL" -n "$NAMESPACE" get pods -l "$selector" -o json >"$pods_json" 2>/dev/null || : >"$pods_json"
    fi
    rollout_out="$(node -e "$NODE_ROLLOUT" "$dep_json" "$pods_json" "$expected" 2>"$WORK/rollout.err")"
    rollout_rc=$?
    case "$rollout_rc" in
      0) log "  OK: the current spec is observed, every replica is updated/ready/available, and the ready pods serve the pinned image." ;;
      1) add_drift "ROLLOUT NOT LANDED: the Deployment's pod template may match the pin while the cluster is not actually serving it.
$(printf '%s\n' "$rollout_out" | sed 's/^/    /')" ;;
      *) add_drift "rollout check INCONCLUSIVE: the status reader exited $rollout_rc (tool failure, not a verdict) — $(head -3 "$WORK/rollout.err" | tr '\n' ' ')" ;;
    esac
  fi
fi

log "check: live object shape vs rendered \`deploy/tacticus/\` manifests"
if [[ ! -x "$RENDERER" ]]; then
  add_drift "shape check INCONCLUSIVE: renderer \`$RENDERER\` is missing or not executable, so live object shape was NOT compared."
elif [[ "$may_execute_renderer" != true ]]; then
  add_drift "shape check INCONCLUSIVE and DELIBERATELY SO: this process (uid $(id -u)) does not own \`$PROJECT_ROOT\` (uid ${checkout_owner_uid:-unknown}), and executing checkout-controlled code as a user who does not control that checkout would hand whoever can write it this runner's privileges on a timer. Install the unit with \`deploy/host/install-systemd-units.sh\`, which sets User=/Group= to the checkout owner, or run this check as that owner."
elif [[ "$kubectl_ok" != true ]]; then
  add_drift "shape check INCONCLUSIVE: no usable kubectl/namespace, so live object shape was NOT compared — it is UNKNOWN, not clean."
else
  # cd first: the renderer uses `git rev-parse --show-toplevel`, and systemd starts in `/`.
  rendered="$(cd "$PROJECT_ROOT" && "$RENDERER" 2>"$WORK/render.err")"
  render_rc=$?
  # A mid-run renderer failure leaves partial YAML; the exit status is the verdict.
  if ((render_rc != 0)); then
    add_drift "shape check INCONCLUSIVE: the renderer \`$RENDERER\` exited $render_rc. Anything it printed before failing is PARTIAL and was DISCARDED, so live object shape was NOT compared — it is UNKNOWN, not clean.
$(head -5 "$WORK/render.err" | sed 's/^/    /')"
  elif [[ -z "$rendered" ]]; then
    add_drift "shape check INCONCLUSIVE: the renderer exited 0 but produced no output, so live object shape was NOT compared."
  else
    # Client-side dry-run is used purely as a YAML parser; it writes nothing.
    printf '%s\n' "$rendered" | awk -v dir="$WORK" '
      BEGIN { n = 0 }
      /^---[[:space:]]*$/ { n++; next }
      { print > (dir "/doc" n ".yaml") }
    '
    shape_docs=("$WORK"/doc*.yaml)
    if [[ ! -e "${shape_docs[0]}" ]]; then
      add_drift "shape check INCONCLUSIVE: the rendered stream could not be split into documents, so nothing was compared."
    else
      shape_problems=()
      shape_inconclusive=()
      for doc in "${shape_docs[@]}"; do
        doc_json="$doc.json"
        if ! "$KUBECTL" create --dry-run=client -f "$doc" -o json >"$doc_json" 2>"$WORK/parse.err"; then
          shape_inconclusive+=("could not parse a rendered document: $(head -3 "$WORK/parse.err" | tr '\n' ' ')")
          continue
        fi
        ident="$(node -e "$NODE_IDENT" "$doc_json" 2>/dev/null)"
        if [[ -z "$ident" ]]; then
          shape_inconclusive+=("a rendered document has no readable kind/name")
          continue
        fi
        # shellcheck disable=SC2086
        set -- $ident
        cmp_out="$(compare_declared_object "$doc_json" "$1" "$2")"
        cmp_rc=$?
        case "$cmp_rc" in
          0) ;;
          1) shape_problems+=("$cmp_out") ;;
          *) shape_inconclusive+=("$cmp_out") ;;
        esac
      done
      if ((${#shape_inconclusive[@]} > 0)); then
        add_drift "shape check INCONCLUSIVE for at least one object, so live shape is UNKNOWN there, not clean:
$(printf '    %s\n' "${shape_inconclusive[@]}")"
      fi
      if ((${#shape_problems[@]} > 0)); then
        add_drift "SHAPE DRIFT: live objects differ from the fields declared in \`deploy/tacticus/\`. The repair is \`scripts/release/render-edge-manifests.sh | kubectl -n $NAMESPACE apply -f -\`.
$(printf '%s\n' "${shape_problems[@]}" | sed 's/^/    /' | head -40)"
      fi
      if ((${#shape_problems[@]} == 0 && ${#shape_inconclusive[@]} == 0)); then
        log "  OK: every field this repository declares matches the live Deployment and Service."
      fi
    fi
  fi
fi

if ((${#drift[@]} == 0)); then
  log "OK: no drift."
else
  log "DRIFT DETECTED:"
  for d in "${drift[@]}"; do printf -- '- %s\n' "$d"; done
fi
exit 0
