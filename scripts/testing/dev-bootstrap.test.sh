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
  reject "$scratch/linked" 'missing development dependencies' 'node_modules'
  [[ ! -e $scratch/linked/node_modules ]]
  mkdir -p "$scratch/linked/node_modules/.bin"
  for tool in eslint husky lint-staged next tsc tsx; do
    ln -s "$PWD/node_modules/.bin/$tool" "$scratch/linked/node_modules/.bin/$tool"
  done
  reject "$scratch/linked" 'an incomplete install' 'vitest'
  [[ ! -e $scratch/linked/node_modules/.bin/vitest ]]
  rm -r "$scratch/linked/node_modules"
  ln -s "$PWD/node_modules" "$scratch/linked/node_modules"
  bootstrap "$scratch/linked" --check
}
fresh_config_tests() (
  local tree="$scratch/fresh" hook="$scratch/default-hooks/pre-commit"
  export config_file="$scratch/gitconfig" default_hooks="$scratch/default-hooks" fixture_git
  fixture_git=$(command -v git)
  git worktree add --quiet --detach "$tree" HEAD
  trap '"$fixture_git" worktree remove --force "$tree"' EXIT
  cp scripts/dev-bootstrap.sh "$tree/scripts/"
  mkdir "$scratch/config-bin" "$scratch/default-hooks"
  : >"$config_file"

  # Keep Git's repository and worktree operations real. Only hook configuration
  # and hook path queries for this fixture use the independent config file.
  cat >"$scratch/config-bin/git" <<'GIT'
#!/usr/bin/env bash
set -eu
case "$*" in
  'config --get core.hooksPath'|'config core.hooksPath .husky/_')
    shift
    exec "$fixture_git" config --file "$config_file" "$@" ;;
  'rev-parse --git-path hooks'|'rev-parse --git-path hooks/pre-commit')
    hooks=$("$fixture_git" config --file "$config_file" --get core.hooksPath) || hooks=$default_hooks
    printf '%s%s\n' "$hooks" "${3#hooks}" ;;
  'rev-parse --show-toplevel') exec "$fixture_git" "$@" ;;
  *) echo "Unexpected fixture Git command: $*" >&2; exit 1 ;;
esac
GIT
  chmod +x "$scratch/config-bin/git"
  local fixture_path="$scratch/config-bin:$PATH"
  for mode in --check setup; do
    local args=()
    if [[ $mode == --check ]]; then args=(--check); fi
    git config --file "$config_file" core.hooksPath other-hooks
    if PATH="$fixture_path" bootstrap "$tree" "${args[@]+"${args[@]}"}" >"$scratch/diagnostic" 2>&1; then
      fail "$mode accepted a conflicting hook path"
    fi
    grep -Fq 'other-hooks' "$scratch/diagnostic"
    [[ $(git config --file "$config_file" --get core.hooksPath) == other-hooks ]]
    git config --file "$config_file" --unset core.hooksPath
    echo '# custom hook' >"$hook"
    chmod +x "$hook"
    if PATH="$fixture_path" bootstrap "$tree" "${args[@]+"${args[@]}"}" >"$scratch/diagnostic" 2>&1; then
      fail "$mode accepted an existing default hook"
    fi
    grep -Fq 'Existing Git hook' "$scratch/diagnostic"
    [[ -x $hook && $(cat "$hook") == '# custom hook' && ! -s $config_file ]]
    rm "$hook"
  done

  ln -s "$PWD/node_modules" "$tree/node_modules"
  PATH="$fixture_path" reject "$tree" 'unset core.hooksPath' 'Run scripts/dev-bootstrap.sh'
  [[ ! -s $config_file && ! -e $tree/.husky/_/pre-commit ]]
  rm "$tree/node_modules"
  PATH="$fixture_path" bootstrap "$tree"
  [[ $(git config --file "$config_file" --get core.hooksPath) == .husky/_ ]]
  PATH="$fixture_path" bootstrap "$tree" --check
)

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
  local tree first second node_dir
  supported_node() {
    node -e 'process.exit(require("semver").satisfies(process.versions.node, require("./package.json").engines.node) ? 0 : 1)'
  }
  if ! supported_node && command -v mise >/dev/null && node_dir=$(mise where "node@$(<.nvmrc)"); then
    export PATH="$node_dir/bin:$PATH"
  fi
  supported_node || fail 'Activate the project Node version before running the cache tests.'
  add_tree "$scratch/first"
  add_tree "$scratch/second"
  for tree in "$scratch/first" "$scratch/second"; do
    ln -s "$PWD/node_modules" "$tree/node_modules"
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
    if [[ -e $fixture/fallback-probe ]]; then echo "$pin"; else echo 0.0.0; fi
    if [[ ${change_version:-} == yes ]]; then touch "$fixture/fallback-probe"; fi ;;
  install)
    [[ ${allow_install:-} == yes ]] || exit 1
    while [[ $1 != --prefix ]]; do shift; done
    bin=$2/node_modules/.bin
    mkdir -p "$bin"
    cp "$fixture/pinned" "$bin/npm"
    touch "$fixture/install-${PWD##*/}"
    while [[ ! -e $fixture/release ]]; do sleep 0.1; done
    touch "$bin/ready"
    if [[ -n ${invalid_winner:-} ]]; then mkdir -p "$invalid_winner/node_modules"; fi ;;
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

  change_version=yes reject "$scratch/first" 'a PATH fallback with no cached npm' "Use npm $pin"
  rm "$scratch/fallback-probe"

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
  local legacy="$XDG_CACHE_HOME/dev-bootstrap/npm-$pin"
  mkdir -p "$legacy/node_modules/.bin" "$legacy/complete/node_modules"
  cp "$scratch/bin/npm" "$legacy/node_modules/.bin/npm"
  allow_install=yes bootstrap "$scratch/first"
  bootstrap "$scratch/first" --check

  export XDG_CACHE_HOME="$scratch/collision-cache"
  local winner="$XDG_CACHE_HOME/dev-bootstrap/published/npm-$pin"
  if invalid_winner="$winner" allow_install=yes bootstrap "$scratch/first" >"$scratch/diagnostic" 2>&1; then
    fail 'Setup accepted an incomplete winner after publication collided.'
  fi
  grep -Fq 'Move that prefix aside' "$scratch/diagnostic"
  change_version=yes reject "$scratch/first" 'an invalid cache winner' 'Move that prefix aside'
  rm "$scratch/fallback-probe"
  mkdir -p "$winner/node_modules/.bin"
  cat >"$winner/node_modules/.bin/npm" <<'NPM'
#!/bin/sh
echo "$pin"
exit 1
NPM
  chmod +x "$winner/node_modules/.bin/npm"
  reject "$scratch/first" 'a failed cached npm version probe' 'Move that prefix aside'
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
  all) hook_tests; fresh_config_tests; cache_tests ;;
  hooks) hook_tests ;;
  fresh) fresh_config_tests ;;
  cache) cache_tests ;;
  repair) repair_test ;;
  *) fail 'Unknown test selection.' ;;
esac
