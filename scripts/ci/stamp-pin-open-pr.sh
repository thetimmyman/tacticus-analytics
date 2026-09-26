#!/usr/bin/env bash
# Open the stamp-pin PR after its branch is pushed. gh's "not permitted" refusal
# (matched by exact text) is expected and prints the compare URL; other failures fail.
# Usage: BRANCH=... PR_TITLE=... PR_BODY=... [BASE=main] stamp-pin-open-pr.sh (needs GH_TOKEN, GITHUB_REPOSITORY)
set -euo pipefail

: "${BRANCH:?BRANCH is required}"
: "${PR_TITLE:?PR_TITLE is required}"
: "${PR_BODY:?PR_BODY is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
BASE="${BASE:-main}"

REFUSAL_TEXT="GitHub Actions is not permitted to create or approve pull requests"

COMPARE_URL="https://github.com/${GITHUB_REPOSITORY}/compare/${BASE}...${BRANCH}?expand=1"

set +e
pr_output="$(gh pr create \
  --title "$PR_TITLE" \
  --body "$PR_BODY" \
  --base "$BASE" \
  --head "$BRANCH" 2>&1)"
pr_status=$?
set -e

if [[ $pr_status -eq 0 ]]; then
  echo "$pr_output"
  exit 0
fi

if [[ "$pr_output" == *"$REFUSAL_TEXT"* ]]; then
  echo "::notice::gh pr create was refused (${REFUSAL_TEXT}) -- branch ${BRANCH} was pushed but has no PR. A lane must open it."
  echo "Branch: ${BRANCH}"
  echo "Compare: ${COMPARE_URL}"
  echo "A lane must open the PR from the compare link above (or enable the repository setting that lets Actions open pull requests)."
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    {
      echo "### Edge runtime pin stamped, PR not opened"
      echo "GitHub Actions is not permitted to create or approve pull requests in this repository, so \`gh pr create\` was refused."
      echo "Branch: \`${BRANCH}\`"
      echo "Compare: ${COMPARE_URL}"
      echo "A lane must open the PR from the compare link above (or enable the repository setting that lets Actions open pull requests)."
    } >> "$GITHUB_STEP_SUMMARY"
  fi
  exit 0
fi

echo "::error::gh pr create failed for a reason other than the known 'Actions may not open pull requests' refusal."
echo "$pr_output" >&2
exit "$pr_status"
