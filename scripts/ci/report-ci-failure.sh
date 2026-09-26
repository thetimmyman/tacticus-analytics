#!/usr/bin/env bash
# File or comment on a GitHub issue for CI jobs with no other alert channel,
# using only GITHUB_TOKEN. One open issue per label; humans close it.
# Usage: GH_TOKEN=... GITHUB_REPOSITORY=owner/repo report-ci-failure.sh <label> <title> <body-file>
set -euo pipefail

label="${1:?usage: report-ci-failure.sh <label> <title> <body-file>}"
title="${2:?usage: report-ci-failure.sh <label> <title> <body-file>}"
body_file="${3:?usage: report-ci-failure.sh <label> <title> <body-file>}"

: "${GH_TOKEN:?GH_TOKEN (or GITHUB_TOKEN) must be set}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"

if [[ ! -f "$body_file" ]]; then
  echo "::error::report-ci-failure.sh: body file '$body_file' does not exist" >&2
  exit 1
fi

# `--label` errors on an unknown label rather than creating it.
if ! gh label list --repo "$GITHUB_REPOSITORY" --search "$label" --json name -q '.[].name' \
    | grep -qx "$label"; then
  gh label create "$label" --repo "$GITHUB_REPOSITORY" \
    --color B60205 \
    --description "Automated CI failure alert (PS-406)" \
    || true # a racing concurrent run may have created it first
fi

# A failed `gh issue list` must fail the step, not read as "no issue" and open a duplicate.
if ! existing="$(gh issue list --repo "$GITHUB_REPOSITORY" --state open --label "$label" \
  --json number --jq '.[0].number' 2>&1)"; then
  echo "::error::report-ci-failure.sh: gh issue list failed: $existing" >&2
  exit 1
fi

if [[ -n "$existing" && "$existing" != "null" ]]; then
  echo "Existing open issue #$existing carries label '$label'; commenting instead of opening a new one." >&2
  gh issue comment "$existing" --repo "$GITHUB_REPOSITORY" --body-file "$body_file"
  echo "issue_number=$existing"
  echo "issue_action=commented"
else
  url="$(gh issue create --repo "$GITHUB_REPOSITORY" --title "$title" --label "$label" --body-file "$body_file")"
  echo "Opened new issue: $url" >&2
  echo "issue_number=${url##*/}"
  echo "issue_action=created"
fi
