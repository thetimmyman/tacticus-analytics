#!/usr/bin/env bash
# Run after development setup in a checkout with its repository hooks installed.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."
scratch=$(mktemp -d "${TMPDIR:-/tmp}/bootstrap.XXXXXXXX")
trees=()
cleanup() {
  touch "$scratch/release"
  wait
  for tree in "${trees[@]+"${trees[@]}"}"; do git worktree remove --force "$tree"; done
  rm -rf -- "$scratch"
}
trap cleanup EXIT

fail() { echo "$*" >&2; exit 1; }
add_tree() {
  git worktree add --quiet --detach --no-checkout "$1" HEAD
  trees+=("$1")
  mkdir -p "$1/scripts" "$1/.husky/_"
  cp scripts/dev-bootstrap.sh "$1/scripts/"
  cp .nvmrc package.json "$1/"
}
bootstrap() { "$1/scripts/dev-bootstrap.sh" "${@:2}"; }
reject() {
  if bootstrap "$1" --check >"$scratch/diagnostic" 2>&1; then
    fail "Expected diagnostics to reject $2"
  fi
  grep -Fq "$3" "$scratch/diagnostic" || { cat "$scratch/diagnostic" >&2; fail "Missing diagnostic for $2"; }
}
hook_tests() {
  [[ $(git config --get core.hooksPath) == .husky/_ ]] || fail 'Run development setup first.'
  local sibling_hook hook
  sibling_hook=$(git rev-parse --git-path hooks/pre-commit)
  [[ -f $sibling_hook && -x $sibling_hook ]] || fail 'Run development setup first.'
  add_tree "$scratch/linked"
  hook="$scratch/linked/.husky/_/pre-commit"
  reject "$scratch/linked" 'a missing hook in this worktree' 'pre-commit'
  [[ ! -e $hook ]] || fail 'Diagnostics created the missing hook.'
  echo '# placeholder' >"$hook"
  chmod 644 "$hook"
  reject "$scratch/linked" 'a non-executable hook' 'pre-commit'
  [[ ! -x $hook && $(cat "$hook") == '# placeholder' ]] || fail 'Diagnostics modified the hook.'
  rm "$hook"
  mkdir "$hook"
  reject "$scratch/linked" 'a directory in place of the hook' 'pre-commit'
  rmdir "$hook"
  cp -p "$sibling_hook" "$hook"
  bootstrap "$scratch/linked" --check
}
wait_for() {
  local i
  for ((i=0; i<300; i++)); do
    if [[ -e $1 ]]; then return 0; fi
    sleep 0.1
  done
  fail "Timed out waiting for ${1##*/}"
}
cache_tests() {
  # The installer pauses after exposing a version-reporting binary, before its
  # supporting files exist. Consumers must never see this intermediate state.
  local tree first second
  add_tree "$scratch/first"
  add_tree "$scratch/second"
  for tree in "$scratch/first" "$scratch/second"; do
    cp -p "$(git rev-parse --git-path hooks/pre-commit)" "$tree/.husky/_/pre-commit"
  done
  export XDG_CACHE_HOME="$scratch/cache" fixture="$scratch"
  export pin
  pin=$(node -p 'require("./package.json").packageManager.slice(4)')
  mkdir "$scratch/bin"
  cat >"$scratch/bin/npm" <<'NPM'
#!/usr/bin/env bash
set -eu
case "$1" in
  --version)
    touch "$fixture/probe-${PWD##*/}"
    echo 0.0.0 ;;
  install)
    [[ ${allow_install:-} == yes ]] || exit 1
    while [[ $1 != --prefix ]]; do shift; done
    bin=$2/node_modules/.bin
    mkdir -p "$bin"
    cp "$fixture/pinned" "$bin/npm"
    touch "$fixture/install-${PWD##*/}"
    while [[ ! -e $fixture/release ]]; do sleep 0.1; done
    touch "$bin/ready" ;;
  *) exit 1 ;;
esac
NPM
  cat >"$scratch/pinned" <<'NPM'
#!/usr/bin/env bash
set -eu
case "$1" in
  --version) echo "$pin" ;;
  ci) [[ -f ${0%/*}/ready ]] && touch "$fixture/ci-${PWD##*/}" ;;
  *) exit 1 ;;
esac
NPM
  chmod +x "$scratch/bin/npm" "$scratch/pinned"
  export PATH="$scratch/bin:$PATH"
  reject "$scratch/first" 'an empty npm cache' "Use npm $pin"
  [[ ! -e $XDG_CACHE_HOME ]] || fail 'Diagnostics populated the empty tool cache.'

  allow_install=yes bootstrap "$scratch/first" & first=$!
  wait_for "$scratch/install-first"
  allow_install=yes bootstrap "$scratch/second" & second=$!
  wait_for "$scratch/probe-second"
  reject "$scratch/first" 'an incomplete npm installation' "Use npm $pin"
  touch "$scratch/release"
  wait "$first"
  wait "$second"
  [[ -f $scratch/ci-first && -f $scratch/ci-second ]] || fail 'Both setups must use a complete npm.'
  bootstrap "$scratch/second" --check

  # Recover an unfinished in-place installation left by an older bootstrap.
  export XDG_CACHE_HOME="$scratch/old-cache"
  mkdir -p "$XDG_CACHE_HOME/dev-bootstrap/npm-$pin/node_modules"
  allow_install=yes bootstrap "$scratch/first"
  bootstrap "$scratch/first" --check
}

# Exercise actual npm ci and Husky in a newly linked development checkout.
# The caller supplies that checkout with its hook still missing.
repair_test() {
  local hook
  hook=$(git rev-parse --git-path hooks/pre-commit)
  [[ -f .git && ! -e $hook && ! -L $hook ]] || fail 'Run the repair test from a fresh linked worktree.'
  [[ $(git config --get core.hooksPath) == .husky/_ ]] || fail 'Expected configured repository hooks.'
  reject "$PWD" 'a missing hook before setup' 'pre-commit'
  bootstrap "$PWD"
  [[ -f $hook && -x $hook ]] || fail 'Development setup did not repair the effective hook.'
  bootstrap "$PWD" --check
}
case "${1:-all}" in
  all) hook_tests; cache_tests ;;
  hooks) hook_tests ;;
  cache) cache_tests ;;
  repair) repair_test ;;
  *) fail 'Unknown test selection.' ;;
esac
