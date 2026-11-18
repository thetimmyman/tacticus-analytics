#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo 'Usage: scripts/dev-bootstrap.sh [--check | --verify]'
  echo 'Install locked development dependencies. --check inspects prerequisites without installing.'
  echo '--verify also runs the public-source scan, lint, typecheck, tests and production build.'
}

die() { echo "dev-bootstrap: $*" >&2; exit 1; }

case "${1:-}" in
  ''|--check|--verify) mode=${1:-setup} ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || { usage >&2; exit 2; }

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
command -v git >/dev/null || die 'Install Git.'
[[ $(git rev-parse --show-toplevel) == "$(pwd -P)" ]] || die 'Run from a Git checkout.'

# npm ci runs the checked-in Husky prepare script. Protect existing hook setups.
hooks=$(git config --get core.hooksPath || :)
case "$hooks" in
  .husky/_) ;;
  '') for hook in "$(git rev-parse --git-path hooks)"/*; do
        [[ ! -f $hook || ! -x $hook || $hook == *.sample ]] || die "Existing Git hook: $hook"
      done ;;
  *) die "Existing core.hooksPath ($hooks) would be replaced by npm ci." ;;
esac

major=$(<.nvmrc)
# Select an installed runtime first. mise can provision Node on a new machine.
use_node() {
  command -v node >/dev/null && node -e '
    const { engines } = require("./package.json")
    const major = process.argv[1]
    const minimum = /^>=(\d+\.\d+\.\d+) </.exec(engines.node)
    if (!minimum) throw Error("Unsupported Node engines range: " + engines.node)
    const installed = process.versions.node
    process.exit(installed.split(".")[0] === major &&
      installed.localeCompare(minimum[1], "en", { numeric: true }) >= 0 ? 0 : 1)
  ' "$major"
}

if ! use_node && command -v mise >/dev/null; then
  if [[ $mode != --check ]]; then mise install "node@$major"; fi
  if node_dir=$(mise where "node@$major" 2>/dev/null); then export PATH="$node_dir/bin:$PATH"; fi
fi
use_node || die "Activate a Node $major release satisfying package.json engines (see .nvmrc)."
command -v npm >/dev/null || die 'Install npm with Node.'

npm_package=$(node -p 'require("./package.json").packageManager')
npm_version=${npm_package#npm@}
if [[ $(npm --version) != "$npm_version" ]]; then
  # Keep a mismatched global npm intact. Nested npm commands use the same pin.
  tools_dir="${XDG_CACHE_HOME:-$HOME/.cache}/dev-bootstrap/npm-$npm_version"
  if [[ ! -x $tools_dir/node_modules/.bin/npm && $mode != --check ]]; then
    npm install --prefix "$tools_dir" --no-save --package-lock=false "$npm_package"
  fi
  export PATH="$tools_dir/node_modules/.bin:$PATH"
fi
[[ $(npm --version) == "$npm_version" ]] || die "Use npm $npm_version or run setup."
if [[ $mode != setup ]]; then
  command -v gitleaks >/dev/null || die 'Install gitleaks to run security:clean-repo.'
fi
echo "Using Node $(node --version) and npm $npm_version."
[[ $mode != --check ]] || exit 0

npm ci --include=dev
[[ -x .husky/_/pre-commit && $(git config --get core.hooksPath) == .husky/_ ]] ||
  die 'The repository pre-commit hook was not installed.'
[[ $mode == --verify ]] || exit 0

npm run security:clean-repo
npm run lint
npm run typecheck
npm test
NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-http://localhost:54321}" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-public-ci-placeholder}" \
NEXT_PUBLIC_SITE_URL="${NEXT_PUBLIC_SITE_URL:-http://localhost:3000}" npm run build
