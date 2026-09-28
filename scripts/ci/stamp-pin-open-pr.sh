#!/usr/bin/env bash
# Open (or reuse) the stamp-pin PR and queue it to squash-merge once the required checks pass.
# GH_TOKEN must be the pin-stamp App token: a GITHUB_TOKEN PR runs no checks, so it could never merge.
# Usage: BRANCH=... PR_TITLE=... PR_BODY=... [BASE=main] stamp-pin-open-pr.sh (needs GH_TOKEN, GITHUB_REPOSITORY)
set -euo pipefail

: "${BRANCH:?BRANCH is required}"
: "${PR_TITLE:?PR_TITLE is required}"
: "${PR_BODY:?PR_BODY is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
BASE="${BASE:-main}"

pr_url="$(gh pr list --repo "$GITHUB_REPOSITORY" --head "$BRANCH" --base "$BASE" --state open --json url --jq '.[0].url // empty')"
if [[ -z "$pr_url" ]]; then
  pr_url="$(gh pr create --repo "$GITHUB_REPOSITORY" \
    --title "$PR_TITLE" \
    --body "$PR_BODY" \
    --base "$BASE" \
    --head "$BRANCH")"
fi
echo "PR: $pr_url"

set +e
merge_output="$(gh pr merge "$pr_url" --repo "$GITHUB_REPOSITORY" --auto --squash 2>&1)"
merge_status=$?
set -e
if [[ $merge_status -ne 0 ]]; then
  echo "::error::Could not queue auto-merge for $pr_url; the pin will not reach $BASE on its own. Check that the repository allows auto-merge and that the pin-stamp App may write contents and pull requests."
  echo "$merge_output" >&2
  exit "$merge_status"
fi
echo "Auto-merge (squash) queued: $pr_url merges once the required checks pass."

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "### Edge runtime pin stamped"
    echo "PR: $pr_url (auto-merge queued; merges once the required checks pass)"
  } >> "$GITHUB_STEP_SUMMARY"
fi
