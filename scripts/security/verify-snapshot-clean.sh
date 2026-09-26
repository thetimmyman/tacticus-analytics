# shellcheck shell=bash
# Certifies a candidate audit snapshot tree (not this repo) is clean enough for external
# auditors: live-secret scan, gitleaks+trufflehog, PII grep, clean-checkout build, one-commit shape.
# Usage: sh scripts/security/verify-snapshot-clean.sh <snapshot-path> [--skip-build] [--hashes FILE] [--tree PATH]
# Env: TACTICUS_SECRETS_JSON_CMD VSC_SECRET_NAMES VSC_SECRET_NAMESPACE VSC_MIN_SECRET_LEN VSC_WORK_BASE
#      VSC_PII_UUID_FILE VSC_PII_ALLOWLIST TA_KNOWN_IDENTITIES_FILE VSC_TEST_BREAK_SCANNER
# Exit: 0 CLEAN, 1 FAILED, 2 PARTIAL (something skipped or non-authoritative; not enough for handover).

if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi

set -euo pipefail

usage() {
  awk 'NR==1{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "$0"
}

die() {
  echo "verify-snapshot-clean: ERROR: $*" >&2
  exit 1
}

TREE=""
HASHES_FILE=""
SKIP_BUILD=0
MINLEN="${VSC_MIN_SECRET_LEN:-12}"

while [ $# -gt 0 ]; do
  case "$1" in
    --skip-build) SKIP_BUILD=1 ;;
    --hashes)
      [ $# -ge 2 ] || die "--hashes needs a file argument"
      HASHES_FILE="$2"
      shift
      ;;
    --tree)
      [ $# -ge 2 ] || die "--tree needs a path argument"
      TREE="$2"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*) die "unknown flag: $1 (see --help)" ;;
    *)
      [ -z "$TREE" ] || die "snapshot path given twice ('$TREE' and '$1')"
      TREE="$1"
      ;;
  esac
  shift
done

[ -n "$TREE" ] || {
  usage >&2
  die "missing required snapshot path"
}
[ -d "$TREE" ] || die "snapshot path is not a directory: $TREE"
TREE="$(cd "$TREE" && pwd)"
if [ -n "$HASHES_FILE" ]; then
  [ -s "$HASHES_FILE" ] || die "--hashes file missing or empty: $HASHES_FILE"
  HASHES_FILE="$(cd "$(dirname "$HASHES_FILE")" && pwd)/$(basename "$HASHES_FILE")"
fi
command -v node >/dev/null 2>&1 || die "node is required"

# Not /tmp: sandboxed node wrappers see a private /tmp.
WORK_BASE="${VSC_WORK_BASE:-$HOME/.cache}"
mkdir -p "$WORK_BASE"
WORK="$(mktemp -d "$WORK_BASE/verify-snapshot.XXXXXX")"
# shellcheck disable=SC2329  # invoked via the EXIT trap
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# Scanner is code only; secrets arrive on stdin. Exits: 0 clean, 3 control failed, 4 crash, 5 unreadable, 6 findings, 7 symlinks.
SCANNER="$WORK/scan.mjs"
cat >"$SCANNER" <<'NODE_EOF'
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const args = process.argv.slice(2);

// Shell-side preflight: proves node can load THIS file from the work dir
// before any result is trusted (a load failure must be distinguishable from
// "live secret present").
if (args[0] === '--selftest') {
  console.log('vsc-scanner-selftest-ok');
  process.exit(0);
}

function opt(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const mode = args[0]; // 'values' | 'hashes'
const tree = opt('--tree');
const minLen = Number(opt('--min-len') ?? 12);
const hashesFile = opt('--hashes-file');
const expectSecrets = (opt('--expect-secrets') ?? '').split(',').filter(Boolean);
// Passed as argv, not env: sandboxed/flatpak node wrappers strip inherited env
// vars (verified 2026-08-07 — env-based sabotage silently never engaged).
const broken = args.includes('--break-scanner');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// Byte-identical substring matcher. --break-scanner simulates a broken
// scanner so the positive-control wiring can be proven to fire.
const matches = (haystack, needle) => (broken ? false : haystack.includes(needle));

// Rejoin line-wrapped base64/PEM-style blocks (64/76-col or any width, with
// optional indentation) so wrapped copies of a value still match (round-3
// major 1).
const DEWRAP_RE = /([A-Za-z0-9+/=_-])\r?\n[ \t]*(?=[A-Za-z0-9+/=_-])/g;
const dewrapStr = (s) => s.replace(DEWRAP_RE, '$1');

const symlinks = new Set();
const readFailures = [];

// Scan the UNION of tracked files, a filesystem walk, and the shipped .git
// metadata. Tracked-only was round 2's blocker 1 (untracked/.gitignore'd
// files invisible); skipping .git entirely was round 3's blocker (a
// remote-URL token in .git/config and the commit author's email shipped
// unseen). Symlinks are flagged, never followed (lstat, not stat — a tracked
// symlink to $HOME once walked outside the snapshot).
function listFiles() {
  const found = new Set();
  const classify = (rel) => {
    const st = lstatSync(join(tree, rel), { throwIfNoEntry: false });
    if (!st) return null;
    if (st.isSymbolicLink()) {
      symlinks.add(rel);
      return null;
    }
    return st;
  };
  try {
    const out = execFileSync('git', ['-C', tree, 'ls-files', '-z'], {
      maxBuffer: 64 * 1024 * 1024,
    });
    for (const name of out.toString('utf8').split('\0')) {
      if (!name) continue;
      const st = classify(name);
      if (st?.isFile()) found.add(name);
    }
  } catch {
    /* not a git repo: the walk below still covers everything */
  }
  const walk = (rel) => {
    const abs = rel ? join(tree, rel) : tree;
    for (const entry of readdirSync(abs)) {
      if (rel === '' && entry === '.git') continue; // .git meta subset added below
      const childRel = rel ? `${rel}/${entry}` : entry;
      const st = classify(childRel);
      if (!st) continue;
      if (st.isDirectory()) walk(childRel);
      else if (st.isFile()) found.add(childRel);
    }
  };
  walk('');
  // Shipped .git metadata that can carry credentials/PII. Objects/packs are
  // zlib-compressed (byte search cannot see into them) and are covered by the
  // check-5 fsck/reflog assertions instead.
  const gitMeta = ['.git/config', '.git/packed-refs', '.git/description', '.git/info/exclude', '.git/info/refs', '.git/COMMIT_EDITMSG'];
  try {
    for (const entry of readdirSync(join(tree, '.git/hooks'))) gitMeta.push(`.git/hooks/${entry}`);
  } catch {
    /* no hooks dir */
  }
  for (const rel of gitMeta) {
    const st = classify(rel);
    if (st?.isFile()) found.add(rel);
  }
  return [...found].sort();
}

function readTreeFile(rel) {
  try {
    return readFileSync(join(tree, rel));
  } catch (err) {
    readFailures.push(`${rel} (${err.code ?? err.message})`);
    return null;
  }
}

const isBinary = (buf) => buf.subarray(0, 8192).includes(0);

const controlFailed = () => {
  console.error('POSITIVE CONTROL FAILED: the scanner did not detect a value it was guaranteed to find.');
  console.error('A zero-findings run from this scanner is meaningless. Refusing to report clean.');
  process.exit(3);
};

// Unreadable files and symlinks FAIL the check: an unread file is unscanned,
// not clean, and a symlink points at content this run cannot certify.
function finishAfterIntegrity(findings) {
  for (const s of symlinks) console.error(`symlink (not followed): ${s}`);
  for (const f of readFailures) console.error(`unreadable: ${f}`);
  if (findings > 0) process.exit(6);
  if (readFailures.length > 0) {
    console.error(`scanner: ${readFailures.length} file(s) could not be read — unscanned files fail the check`);
    process.exit(5);
  }
  if (symlinks.size > 0) {
    console.error(`scanner: ${symlinks.size} symlink(s) present — flagged, not followed; remove them from the snapshot`);
    process.exit(7);
  }
  process.exit(0);
}

function runValuesMode() {
  // stdin: `kubectl get secret -o json` shape — a single Secret or a List of
  // Secrets. Values live only in this process's memory; they are never
  // written or printed.
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    /* empty */
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('scanner: could not parse secret JSON from stdin (kubectl failed or produced nothing?)');
    process.exit(4);
  }
  const secrets = parsed?.kind === 'List' ? (parsed.items ?? []) : [parsed];
  const presentNames = new Set(secrets.map((s) => s?.metadata?.name).filter(Boolean));
  // A partial List (one Secret missing from the source output) must not
  // silently shrink the scanned universe (round-3 fix).
  const missing = expectSecrets.filter((n) => !presentNames.has(n));
  if (missing.length > 0) {
    console.error(`scanner: expected Secret(s) missing from the source output: ${missing.join(', ')} — universe incomplete, refusing to scan`);
    process.exit(4);
  }

  const bases = [];
  const tooShort = [];
  for (const secret of secrets) {
    const name = secret?.metadata?.name;
    for (const [key, b64] of Object.entries(secret?.data ?? {})) {
      const label = name ? `${name}/${key}` : key;
      const buf = Buffer.from(String(b64), 'base64');
      if (buf.length >= minLen) bases.push({ label, buf });
      else tooShort.push(label);
    }
  }
  if (bases.length === 0) {
    console.error(`scanner: no secret values >= ${minLen} bytes — nothing to scan is a FAILURE, not a pass`);
    process.exit(4);
  }
  if (tooShort.length > 0) {
    console.log(`note: ${tooShort.length} value(s) below ${minLen} bytes NOT covered by this scan: ${tooShort.sort().join(', ')}`);
  }

  // JSON-leaf sub-values (dockerconfigjson etc.), one nested base64 decode,
  // and the password half of user:password auth blobs (a remote URL embeds
  // the token as oauth2:TOKEN@host — the joined pair never matches it).
  const pushBase = (label, buf) => {
    if (buf.length >= minLen) bases.push({ label, buf });
  };
  const jsonLeaves = (label, buf) => {
    const str = buf.toString('utf8');
    if (!/^\s*[[{]/.test(str)) return;
    let obj;
    try {
      obj = JSON.parse(str);
    } catch {
      return;
    }
    const visit = (node, path) => {
      if (typeof node === 'string') {
        pushBase(`${label}!${path}`, Buffer.from(node, 'utf8'));
        if (/^[A-Za-z0-9+/]+=*$/.test(node) && node.length >= 16) {
          const dec = Buffer.from(node, 'base64');
          if (!isBinary(dec)) {
            pushBase(`${label}!${path}(decoded)`, dec);
            const decStr = dec.toString('utf8');
            const colon = decStr.indexOf(':');
            // >= 0, not > 0: an empty-username auth (":token") must still
            // yield the bare token as a derived value.
            if (colon >= 0) pushBase(`${label}!${path}(password)`, Buffer.from(decStr.slice(colon + 1), 'utf8'));
          }
        }
      } else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) visit(v, path ? `${path}.${k}` : k);
      }
    };
    visit(obj, '');
  };
  for (const b of [...bases]) jsonLeaves(b.label, b.buf);

  const values = [];
  const seen = new Set();
  const push = (label, buf) => {
    const key = sha256(buf);
    if (buf.length >= 8 && !seen.has(key)) {
      seen.add(key);
      values.push({ label, buf, hash: key });
    }
  };
  for (const { label, buf } of bases) {
    push(label, buf);
    const b64 = buf.toString('base64');
    push(`${label} (b64)`, Buffer.from(b64, 'latin1'));
    push(`${label} (b64-nopad)`, Buffer.from(b64.replace(/=+$/, ''), 'latin1'));
    push(`${label} (b64url)`, Buffer.from(b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), 'latin1'));
    const str = buf.toString('utf8');
    if (Buffer.from(str, 'utf8').equals(buf)) {
      const uri = encodeURIComponent(str);
      if (uri !== str) push(`${label} (uri)`, Buffer.from(uri, 'utf8'));
      const json = JSON.stringify(str).slice(1, -1);
      if (json !== str) push(`${label} (json)`, Buffer.from(json, 'utf8'));
    }
  }

  const files = listFiles();
  if (files.length === 0) {
    console.error('scanner: snapshot tree has no files to scan');
    process.exit(4);
  }

  // Mandatory positive control: inject a known live value into an IN-MEMORY
  // copy of a snapshot file and require detection in raw, base64, AND
  // line-wrapped base64 form — proving matcher, variant machinery, and the
  // dewrap normalizer.
  const control = values.find((v) => v.label.endsWith('/POSTGRES_PASSWORD') || v.label === 'POSTGRES_PASSWORD') ?? values[0];
  const controlB64Str = control.buf.toString('base64');
  const controlB64 = Buffer.from(controlB64Str, 'latin1');
  const controlWrapped = controlB64Str.replace(/(.{16})/g, '$1\n');
  const sample = readTreeFile(files[0]) ?? Buffer.alloc(0);
  const injected = Buffer.concat([sample, Buffer.from('\n'), control.buf, Buffer.from('\n'), controlB64, Buffer.from('\n')]);
  const dewrappedControl = Buffer.from(dewrapStr(controlWrapped), 'latin1');
  if (!matches(injected, control.buf) || !matches(injected, controlB64) || !matches(dewrappedControl, controlB64)) controlFailed();
  console.log(`positive control fired: ${control.label} (sha256:${control.hash.slice(0, 12)}) detected raw, base64 and line-wrapped in an in-memory injected copy of ${files[0]}`);

  let findings = 0;
  let binaries = 0;
  for (const rel of files) {
    const buf = readTreeFile(rel);
    if (!buf) continue;
    if (isBinary(buf)) binaries += 1;
    const hitHere = new Set();
    for (const v of values) {
      if (matches(buf, v.buf)) {
        hitHere.add(v.label);
        findings += 1;
        console.log(`MATCH ${v.label} sha256:${v.hash.slice(0, 12)} -> ${rel}`);
      }
    }
    // Second pass on a line-unwrapped copy catches PEM/kubeconfig-style
    // wrapped base64 (round-3 major 1).
    const str = buf.toString('latin1');
    if (str.includes('\n')) {
      const dew = dewrapStr(str);
      if (dew !== str) {
        const dewBuf = Buffer.from(dew, 'latin1');
        for (const v of values) {
          if (!hitHere.has(v.label) && matches(dewBuf, v.buf)) {
            findings += 1;
            console.log(`MATCH ${v.label} sha256:${v.hash.slice(0, 12)} -> ${rel} (line-wrapped)`);
          }
        }
      }
    }
  }
  console.log(`scanned ${files.length} file(s) (tracked+walk+.git-meta union; ${binaries} binary) against ${values.length} value form(s) from ${bases.length} value(s): ${findings} match(es)`);
  if (binaries > 0) {
    console.log(`note: ${binaries} binary file(s) were byte-scanned here, but the text-based greps in check 3 skip them`);
  }
  finishAfterIntegrity(findings);
}

function runHashesMode() {
  // hashes mode (L4 T1.1 contract): the process never holds a secret value.
  // Extract candidate strings, hash them, compare against the label set.
  // Structurally NOT authoritative — the wrapper caps the verdict at PARTIAL.
  const hashToLabel = new Map();
  const unreachable = [];
  for (const line of readFileSync(hashesFile, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const [label, hex, flag] = t.split(/\s+/);
    if (!label || !/^[0-9a-fA-F]{64}$/.test(hex ?? '')) {
      console.error(`scanner: bad hashes line (want "<label> <sha256> [unreachable]"): ${t}`);
      process.exit(4);
    }
    hashToLabel.set(hex.toLowerCase(), label);
    if (flag === 'unreachable') unreachable.push(label);
  }
  if (hashToLabel.size === 0) {
    console.error('scanner: hashes file contains no entries');
    process.exit(4);
  }
  if (unreachable.length > 0) {
    console.log(`WARNING: ${unreachable.length} label(s) flagged by the hash generator as STRUCTURALLY UNREACHABLE by tokenization (multi-line or non-token-shaped) — this scan cannot cover them: ${unreachable.sort().join(', ')}`);
  }

  const candMin = Math.max(6, minLen);
  const fixedRes = [
    /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, // JWT
    /postgres(?:ql)?:\/\/[^\s'"]+/g, // postgres URI
    /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, // UUID
  ];
  const runRe = new RegExp(`[A-Za-z0-9+/=_.-]{${candMin},}`, 'g'); // token runs incl. dotted keys
  const dquoteRe = new RegExp(`"([^"\\n]{${candMin},512})"`, 'g'); // double-quoted literals
  const squoteRe = new RegExp(`'([^'\\n]{${candMin},512})'`, 'g'); // single-quoted literals
  const extract = (text) => {
    const seen = new Map(); // candidate -> first index
    const add = (tok, idx) => {
      if (tok.length >= candMin && !seen.has(tok)) seen.set(tok, idx);
    };
    for (const re of [...fixedRes, runRe]) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) add(m[0], m.index ?? 0);
    }
    for (const re of [dquoteRe, squoteRe]) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) add(m[1], (m.index ?? 0) + 1);
    }
    // env-style KEY=value and yaml-style "key: value" right-hand sides.
    let lineStart = 0;
    for (const line of text.split('\n')) {
      let m = /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_.]*\s*=\s*(.+?)\s*$/.exec(line);
      if (m) {
        const rhs = m[1].replace(/^["']|["']$/g, '');
        add(rhs, lineStart + line.indexOf(m[1]));
      }
      m = /^\s*[A-Za-z_][A-Za-z0-9_.-]*:\s+(.+?)\s*$/.exec(line);
      if (m) {
        const rhs = m[1].replace(/^["']|["']$/g, '');
        add(rhs, lineStart + line.indexOf(m[1]));
      }
      lineStart += line.length + 1;
    }
    return seen;
  };
  const compare = (token) =>
    broken ? undefined : hashToLabel.get(sha256(Buffer.from(token, 'latin1')));

  // Positive control: a synthetic token whose hash is added to the set — this
  // proves extractor + hasher + comparator end-to-end without any real value.
  const controlToken = 'ctrl' + randomBytes(24).toString('hex');
  hashToLabel.set(sha256(Buffer.from(controlToken, 'latin1')), '__positive_control__');
  let controlFired = false;
  for (const token of extract(`x ${controlToken} y`).keys()) {
    if (compare(token) === '__positive_control__') controlFired = true;
  }
  if (!controlFired) controlFailed();
  console.log('positive control fired: synthetic token detected via extract->hash->compare');

  const files = listFiles();
  if (files.length === 0) {
    console.error('scanner: snapshot tree has no files to scan');
    process.exit(4);
  }
  let findings = 0;
  for (const rel of files) {
    const buf = readTreeFile(rel);
    if (!buf) continue;
    const text = buf.toString('latin1');
    for (const [token, idx] of extract(text)) {
      const label = compare(token);
      if (label && label !== '__positive_control__') {
        findings += 1;
        const line = text.slice(0, idx).split('\n').length;
        console.log(`MATCH ${label} -> ${rel}:${line}`);
      }
    }
  }
  console.log(`scanned ${files.length} file(s) (tracked+walk+.git-meta union) against ${hashToLabel.size - 1} hash(es): ${findings} match(es)`);
  finishAfterIntegrity(findings);
}

if (!tree || (mode !== 'values' && mode !== 'hashes')) {
  console.error('scanner: bad invocation');
  process.exit(4);
}
try {
  if (mode === 'values') runValuesMode();
  else runHashesMode();
} catch (err) {
  // A crash must never look like a verdict (round-3 major 2: an ELOOP crash
  // was reported as "live secret present").
  console.error(`scanner: crashed — results not trustworthy: ${err?.stack ?? err}`);
  process.exit(4);
}
NODE_EOF
[ -s "$SCANNER" ] || die "scanner program failed to materialize at $SCANNER"

# node must load the scanner first, or a load failure looks like a finding.
PREFLIGHT_OK=1
PREFLIGHT_OUT="$(node "$SCANNER" --selftest 2>&1 || true)"
if [ "$PREFLIGHT_OUT" != "vsc-scanner-selftest-ok" ]; then
  PREFLIGHT_OK=0
fi

# .git/config can carry tokens in remote URLs.
GIT_META_FILES=()
for _f in config packed-refs description info/exclude info/refs COMMIT_EDITMSG; do
  [ -f "$TREE/.git/$_f" ] && GIT_META_FILES+=("$TREE/.git/$_f")
done
if [ -d "$TREE/.git/hooks" ]; then
  for _h in "$TREE"/.git/hooks/*; do
    [ -f "$_h" ] && GIT_META_FILES+=("$_h")
  done
fi

# Each check sets S<n> to PASS/FAIL/SKIPPED/PARTIAL; set -e is on, so guard every fallible call.
S1="" S2="" S3="" S4="" S5=""

echo "=== verify-snapshot-clean: $TREE ==="
echo "(the certified tree is never written to; build runs in a disposable clone)"
echo ""

# Check 5 first: a malformed snapshot makes the rest moot.
echo "--- check 5: history + tree shape ---"
S5="PASS"
COMMITS="$(git -C "$TREE" rev-list --all --count 2>/dev/null || echo "not-a-git-repo")"
if [ "$COMMITS" = "1" ]; then
  echo "one commit across all refs"
else
  S5="FAIL (rev-list --all --count = $COMMITS, want 1)"
  echo "FAIL: $S5"
fi
if [ -e "$TREE/.git/logs" ]; then
  S5="FAIL (.git/logs exists — a shipped reflog can recover pre-snapshot content)"
  echo "FAIL: $S5"
else
  echo "no reflog shipped (.git/logs absent)"
fi
UNREACHABLE="$(git -C "$TREE" fsck --unreachable --no-reflogs 2>/dev/null | grep '^unreachable' || true)"
if [ -n "$UNREACHABLE" ]; then
  S5="FAIL (unreachable objects present — git fsck can still recover pre-snapshot content)"
  echo "FAIL: $S5"
  printf '%s\n' "$UNREACHABLE" | head -n 10
else
  echo "no unreachable objects (fsck --unreachable --no-reflogs empty)"
fi
DIRTY="$(git -C "$TREE" status --porcelain --ignored 2>/dev/null || echo "??status-failed")"
if [ -n "$DIRTY" ]; then
  S5="FAIL (untracked/ignored/modified files present — a snapshot ships nothing outside its commit)"
  echo "FAIL: $S5"
  printf '%s\n' "$DIRTY" | head -n 20
else
  echo "working tree pristine (status --porcelain --ignored empty)"
fi
echo ""

echo "--- check 1: live-secret scan ($([ -n "$HASHES_FILE" ] && echo "hash mode: $HASHES_FILE" || echo "value mode")) ---"
HASH_MODE=0
[ -z "$HASHES_FILE" ] || HASH_MODE=1
if [ "$PREFLIGHT_OK" -ne 1 ]; then
  S1="FAIL (scanner preflight failed — node cannot load the scanner from $WORK; sandboxed node sees a different filesystem? set VSC_WORK_BASE. node said: $PREFLIGHT_OUT)"
  echo "FAIL: $S1"
else
  RC=0
  # Passed as argv, not env: sandboxed node wrappers strip env vars.
  BREAK_ARGS=()
  if [ "${VSC_TEST_BREAK_SCANNER:-}" = "1" ]; then
    BREAK_ARGS=(--break-scanner)
    echo "WARNING: VSC_TEST_BREAK_SCANNER=1 — matcher sabotaged; this run MUST fail its positive control"
  fi
  if [ "$HASH_MODE" -eq 1 ]; then
    echo "secrets source: hashes file (value-free; NOT authoritative — verdict is capped at PARTIAL)"
    node "$SCANNER" hashes --tree "$TREE" --hashes-file "$HASHES_FILE" --min-len "$MINLEN" ${BREAK_ARGS[@]+"${BREAK_ARGS[@]}"} || RC=$?
  else
    SECRET_NAMES="${VSC_SECRET_NAMES:-application-secrets registry-pull-secret}"
    SECRET_NAMESPACE="${VSC_SECRET_NAMESPACE:-app}"
    DEFAULT_CMD="kubectl -n $SECRET_NAMESPACE get secret $SECRET_NAMES -o json"
    SECRETS_CMD="${TACTICUS_SECRETS_JSON_CMD:-$DEFAULT_CMD}"
    # Always name the source so a fixture override is visible.
    if [ -n "${TACTICUS_SECRETS_JSON_CMD:-}" ]; then
      echo "secrets source: $SECRETS_CMD"
      echo "WARNING: TACTICUS_SECRETS_JSON_CMD override in effect — this is NOT the live-cluster default"
    else
      echo "secrets source (live default): $SECRETS_CMD"
    fi
    EXPECT_ARGS=()
    if [ -z "${TACTICUS_SECRETS_JSON_CMD:-}" ] || [ -n "${VSC_SECRET_NAMES:-}" ]; then
      EXPECT_ARGS=(--expect-secrets "$(printf '%s' "$SECRET_NAMES" | tr ' ' ',')")
    fi
    # Piped, never written to disk. pipefail surfaces a dead kubectl.
    sh -c "$SECRETS_CMD" | node "$SCANNER" values --tree "$TREE" --min-len "$MINLEN" \
      ${EXPECT_ARGS[@]+"${EXPECT_ARGS[@]}"} ${BREAK_ARGS[@]+"${BREAK_ARGS[@]}"} || RC=$?
  fi
  case "$RC" in
    0)
      if [ "$HASH_MODE" -eq 1 ]; then
        S1="PARTIAL (hash mode found nothing, but is structurally not authoritative — run value mode for a CLEAN verdict)"
      else
        S1="PASS"
      fi
      ;;
    6) S1="FAIL (live secret value(s) present in the snapshot)" ;;
    3) S1="FAIL (positive control failed — scanner is broken, zero findings would be meaningless)" ;;
    5) S1="FAIL (unreadable file(s) in the snapshot — unscanned is not clean)" ;;
    7) S1="FAIL (symlink(s) present — flagged, not followed; content pointing outside the tree cannot be certified)" ;;
    4) S1="FAIL (scanner/config error — secrets source dead, universe incomplete, or scanner crashed; results not trustworthy)" ;;
    *) S1="FAIL (scanner crashed with unexpected exit $RC — results not trustworthy)" ;;
  esac
  case "$S1" in FAIL*) echo "FAIL: $S1" ;; esac
fi
echo ""

echo "--- check 2: gitleaks / trufflehog ---"
TOOLS_RAN=0
TOOLS_BAD=0
if command -v gitleaks >/dev/null 2>&1; then
  TOOLS_RAN=$((TOOLS_RAN + 1))
  GL_LOG="$WORK/gitleaks.log"
  GL_RC=0
  # Name .gitleaks.toml explicitly (cwd discovery can drop it); a missing config is a FAIL.
  if [ ! -f "$TREE/.gitleaks.toml" ]; then
    GL_RC=99
    echo "gitleaks: .gitleaks.toml missing from snapshot root" >"$GL_LOG"
  else
    (cd "$TREE" && gitleaks dir . --config .gitleaks.toml --no-banner --redact --exit-code 1) >"$GL_LOG" 2>&1 || GL_RC=$?
  fi
  if [ "$GL_RC" -eq 0 ]; then
    echo "gitleaks: clean"
  else
    TOOLS_BAD=$((TOOLS_BAD + 1))
    echo "gitleaks: findings or error (exit $GL_RC); last lines:"
    tail -n 20 "$GL_LOG"
  fi
else
  echo "gitleaks: SKIPPED (not installed)"
fi
if command -v trufflehog >/dev/null 2>&1; then
  TOOLS_RAN=$((TOOLS_RAN + 1))
  TH_LOG="$WORK/trufflehog.log"
  TH_RC=0
  trufflehog filesystem "$TREE" --fail --no-update >"$TH_LOG" 2>&1 || TH_RC=$?
  if [ "$TH_RC" -eq 0 ]; then
    echo "trufflehog: clean"
  else
    TOOLS_BAD=$((TOOLS_BAD + 1))
    echo "trufflehog: findings or error (exit $TH_RC); last lines:"
    tail -n 20 "$TH_LOG"
  fi
else
  echo "trufflehog: SKIPPED (not installed)"
fi
if [ "$TOOLS_RAN" -eq 0 ]; then
  S2="SKIPPED (neither gitleaks nor trufflehog installed — install at least one for a full verdict)"
  echo "SKIPPED: $S2"
elif [ "$TOOLS_BAD" -gt 0 ]; then
  S2="FAIL ($TOOLS_BAD scanner(s) reported findings or errored)"
  echo "FAIL: $S2"
elif [ "$TOOLS_RAN" -lt 2 ]; then
  # Without gitleaks the .gitleaks.toml tripwires never ran.
  S2="PARTIAL (only $TOOLS_RAN of 2 scanners ran — install both gitleaks and trufflehog for a CLEAN verdict)"
  echo "PARTIAL: $S2"
else
  S2="PASS (both scanners ran clean)"
fi
echo ""

echo "--- check 3: PII grep (consumer emails + commit identities + known-real UUIDs) ---"
EMAIL_RE='[A-Za-z0-9._%+-]+@(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|aol|proton|protonmail|pm|gmx|zoho|mail|yandex|qq|163|126|naver|web|t-online|orange|wanadoo|free|btinternet|sky|virginmedia|comcast|verizon|att|sbcglobal|cox|charter|earthlink|rocketmail|fastmail|hushmail|tutanota|tuta)\.[A-Za-z]{2,6}(\.[A-Za-z]{2,3})?'
EMAIL_HITS="$(grep -rIonE --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.next "$EMAIL_RE" "$TREE" 2>/dev/null || true)"
if [ ${#GIT_META_FILES[@]} -gt 0 ]; then
  GIT_META_HITS="$(grep -HIonE "$EMAIL_RE" "${GIT_META_FILES[@]}" 2>/dev/null || true)"
  if [ -n "$GIT_META_HITS" ]; then
    EMAIL_HITS="$(printf '%s\n%s' "$EMAIL_HITS" "$GIT_META_HITS" | sed '/^$/d')"
  fi
fi
IDENT_LINES="$(git -C "$TREE" log --all --format='%an %ae%n%cn %ce' 2>/dev/null | sort -u || true)"
IDENT_EMAILS="$(printf '%s\n' "$IDENT_LINES" | { grep -oE "$EMAIL_RE" || true; } | sort -u)"
if [ -n "$IDENT_EMAILS" ]; then
  IDENT_HITS="$(printf '%s\n' "$IDENT_EMAILS" | sed 's|^|.git(commit-identity):1:|')"
  EMAIL_HITS="$(printf '%s\n%s' "$EMAIL_HITS" "$IDENT_HITS" | sed '/^$/d')"
fi
if [ -n "${VSC_PII_ALLOWLIST:-}" ] && [ -s "${VSC_PII_ALLOWLIST:-}" ] && [ -n "$EMAIL_HITS" ]; then
  # Exact match: a blank allowlist line must not match everything.
  FILTERED="$(printf '%s\n' "$EMAIL_HITS" | awk -F: -v al="$VSC_PII_ALLOWLIST" '
    BEGIN {
      while ((getline l < al) > 0) {
        gsub(/^[ \t]+|[ \t\r]+$/, "", l);
        if (l != "" && l !~ /^#/) allow[l] = 1;
      }
      close(al);
    }
    { if ($NF in allow) { suppressed++; next } print }
    END { printf "___suppressed=%d\n", suppressed + 0 > "/dev/stderr" }' 2>"$WORK/allow.count")"
  SUPPRESSED="$(sed -n 's/^___suppressed=//p' "$WORK/allow.count")"
  echo "allowlist: suppressed ${SUPPRESSED:-0} exact-match hit(s) via $VSC_PII_ALLOWLIST"
  EMAIL_HITS="$FILTERED"
fi
EMAIL_OK=1
if [ -n "$EMAIL_HITS" ]; then
  EMAIL_OK=0
  echo "consumer-domain email address(es) found (working tree, .git metadata, commit identities):"
  printf '%s\n' "$EMAIL_HITS"
else
  echo "emails: clean (working tree, .git metadata, commit identities)"
fi
echo "note: text greps skip binary files; binaries are byte-scanned by check 1 (count reported there)"
UUID_STATUS=""
if [ -n "${VSC_PII_UUID_FILE:-}" ]; then
  [ -s "$VSC_PII_UUID_FILE" ] || die "VSC_PII_UUID_FILE set but missing/empty: $VSC_PII_UUID_FILE"
  UUID_HITS="$(grep -rIonFf "$VSC_PII_UUID_FILE" --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.next "$TREE" 2>/dev/null || true)"
  if [ ${#GIT_META_FILES[@]} -gt 0 ]; then
    UUID_META_HITS="$(grep -HIonFf "$VSC_PII_UUID_FILE" "${GIT_META_FILES[@]}" 2>/dev/null || true)"
    if [ -n "$UUID_META_HITS" ]; then
      UUID_HITS="$(printf '%s\n%s' "$UUID_HITS" "$UUID_META_HITS" | sed '/^$/d')"
    fi
  fi
  if [ -n "$UUID_HITS" ]; then
    UUID_STATUS="FAIL"
    echo "known-real UUID(s) found:"
    printf '%s\n' "$UUID_HITS"
  else
    UUID_STATUS="PASS"
    echo "uuids: clean"
  fi
else
  UUID_STATUS="SKIPPED"
  echo "uuids: SKIPPED — no known-real UUID list provided (set VSC_PII_UUID_FILE; the list is itself PII, keep it outside the repo)"
fi
# Known ids and handles from TA_KNOWN_IDENTITIES_FILE; output is masked.
IDENTITY_STATUS="SKIPPED"
if [ -n "${TA_KNOWN_IDENTITIES_FILE:-}" ]; then
  IDENTITY_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-real-identities.mjs"
  set +e
  (cd "$TREE" && node "$IDENTITY_SCRIPT" --scan)
  IDENTITY_RC=$?
  set -e
  case "$IDENTITY_RC" in
    0) IDENTITY_STATUS="PASS" ;;
    1) IDENTITY_STATUS="FAIL" ;;
    *) die "real-identity scan could not run (exit $IDENTITY_RC)" ;;
  esac
else
  echo "identities: SKIPPED (TA_KNOWN_IDENTITIES_FILE not set)"
fi
if [ "$EMAIL_OK" -eq 0 ] || [ "$UUID_STATUS" = "FAIL" ] || [ "$IDENTITY_STATUS" = "FAIL" ]; then
  S3="FAIL (emails: $([ "$EMAIL_OK" -eq 1 ] && echo clean || echo FOUND); uuids: $UUID_STATUS; identities: $IDENTITY_STATUS)"
  echo "FAIL: $S3"
elif [ "$UUID_STATUS" = "SKIPPED" ]; then
  S3="SKIPPED (emails clean; UUID list not provided)"
else
  S3="PASS"
fi
echo ""

echo "--- check 4: clean-checkout build (npm ci + typecheck + build, FW_OFFLOAD=0) ---"
if [ "$SKIP_BUILD" -eq 1 ]; then
  S4="SKIPPED (--skip-build)"
  echo "SKIPPED: $S4"
else
  BUILD_DIR="$WORK/build-clone"
  BUILD_LOG="$WORK/build.log"
  if ! git clone --quiet -- "$TREE" "$BUILD_DIR" >>"$BUILD_LOG" 2>&1; then
    S4="FAIL (could not clone the snapshot for a clean-checkout build)"
    echo "FAIL: $S4"
    tail -n 20 "$BUILD_LOG"
  else
    echo "building in disposable clone: $BUILD_DIR"
    BUILD_OK=1
    for STEP in "ci" "run typecheck" "run build"; do
      echo "npm $STEP ..."
      # shellcheck disable=SC2086  # STEP is a fixed npm subcommand; word-splitting intended
      if ! (cd "$BUILD_DIR" && env FW_OFFLOAD=0 HUSKY=0 npm $STEP) >>"$BUILD_LOG" 2>&1; then
        BUILD_OK=0
        S4="FAIL (npm $STEP failed; last lines follow)"
        echo "FAIL: $S4"
        tail -n 50 "$BUILD_LOG"
        break
      fi
    done
    [ "$BUILD_OK" -eq 0 ] || S4="PASS"
  fi
fi
echo ""

echo "=== summary ==="
echo "check 1 (live-secret scan)   : $S1"
echo "check 2 (gitleaks/trufflehog): $S2"
echo "check 3 (PII grep)           : $S3"
echo "check 4 (clean build)        : $S4"
echo "check 5 (history/tree shape) : $S5"

VERDICT="CLEAN"
EXIT=0
for S in "$S1" "$S2" "$S3" "$S4" "$S5"; do
  case "$S" in
    FAIL*)
      VERDICT="FAILED"
      EXIT=1
      ;;
    SKIPPED* | PARTIAL*)
      if [ "$VERDICT" != "FAILED" ]; then
        VERDICT="PARTIAL"
        EXIT=2
      fi
      ;;
  esac
done
echo ""
case "$VERDICT" in
  CLEAN) echo "VERDICT: CLEAN — all five checks ran and passed" ;;
  PARTIAL) echo "VERDICT: PARTIAL — no failures, but skipped or non-authoritative checks mean this run is NOT sufficient for handover (exit 2)" ;;
  FAILED) echo "VERDICT: FAILED — do not hand this snapshot to auditors" ;;
esac
exit "$EXIT"
