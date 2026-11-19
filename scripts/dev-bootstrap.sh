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
require_pre_commit() {
  local hook
  hook=$(git rev-parse --git-path hooks/pre-commit)
  [[ -f $hook && -x $hook ]] ||
    die "Missing or non-executable pre-commit hook at $hook. Run scripts/dev-bootstrap.sh to install a missing hook, or restore the existing file and its execute permission."
}

if hooks=$(git config --get core.hooksPath); then
  [[ $hooks == .husky/_ ]] || die "Existing core.hooksPath ($hooks) would be replaced by npm ci."
  if [[ $mode == --check ]]; then require_pre_commit; fi
else
  [[ $? == 1 ]] || die 'Could not read core.hooksPath.'
  for hook in "$(git rev-parse --git-path hooks)"/*; do
    [[ ! -f $hook || ! -x $hook || $hook == *.sample ]] || die "Existing Git hook: $hook"
  done
  if [[ $mode == --check ]]; then
    die 'Repository hooks are not configured. Run scripts/dev-bootstrap.sh in this checkout.'
  fi
fi

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
npm_is_pinned() {
  local version
  version=$("$1" --version) && [[ $version == "$npm_version" ]]
}

if ! npm_is_pinned npm; then
  # Keep a mismatched global npm intact. Nested npm commands use the same pin.
  # Older cache prefixes were populated in place and can be incomplete.
  cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/dev-bootstrap/published"
  tools_dir="$cache_dir/npm-$npm_version"
  if [[ ! -e $tools_dir && ! -L $tools_dir && $mode != --check ]]; then
    (
      mkdir -p -- "$cache_dir"
      stage=$(mktemp -d "$cache_dir/.npm.XXXXXXXX")
      trap 'rm -rf -- "$stage"' EXIT
      npm install --prefix "$stage" --no-save --package-lock=false "$npm_package"
      npm_is_pinned "$stage/node_modules/.bin/npm" ||
        die "Installation did not produce npm $npm_version."

      # Rename on the same filesystem. Only a complete prefix becomes visible.
      node -e '
        const { renameSync } = require("node:fs")
        const [stage, destination] = process.argv.slice(1)
        try {
          renameSync(stage, destination)
        } catch (error) {
          if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error
        }
      ' "$stage" "$tools_dir"
    )
  fi
  [[ -e $tools_dir || -L $tools_dir ]] || die "Use npm $npm_version or run setup."
  cached_npm="$tools_dir/node_modules/.bin/npm"
  if [[ ! -f $cached_npm || ! -x $cached_npm ]] || ! npm_is_pinned "$cached_npm"; then
    die "Invalid cached npm at $tools_dir. Move that prefix aside and run scripts/dev-bootstrap.sh."
  fi
  export PATH="$tools_dir/node_modules/.bin:$PATH"
fi
if [[ $mode != setup ]]; then
  command -v gitleaks >/dev/null || die 'Install gitleaks to run security:clean-repo.'
fi
echo "Using Node $(node --version) and npm $npm_version."
if [[ $mode == --check ]]; then
  for tool in eslint husky lint-staged next tsc tsx vitest; do
    executable="node_modules/.bin/$tool"
    [[ -f $executable && -x $executable ]] || die "Missing executable $executable. Run scripts/dev-bootstrap.sh."
  done
  exit 0
fi

npm ci --include=dev
[[ $(git config --get core.hooksPath) == .husky/_ ]] || die 'The repository hooks path was not configured.'
require_pre_commit
[[ $mode == --verify ]] || exit 0

bash scripts/testing/dev-bootstrap.test.sh
npm run security:clean-repo
npm run lint
npm run typecheck
npm test
NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-http://localhost:54321}" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-public-ci-placeholder}" \
NEXT_PUBLIC_SITE_URL="${NEXT_PUBLIC_SITE_URL:-http://localhost:3000}" npm run build
