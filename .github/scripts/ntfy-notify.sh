#!/usr/bin/env bash
# Post to a public ntfy.sh topic. The topic name is the third argument.
# beds_lm_1234, beds_sl_1234, beds_config_1234, beds_errors_1234,
# beds_juniors_1234 and beds_closed_1234 are the topics in use.
set -euo pipefail

title="${1:?title}"
body="${2:?body}"
topic="${3:?topic}"

url="https://ntfy.sh/${topic}"

args=(-sSf -d "$body" -H "Title: ${title}" -H "Tags: squash")

if [[ "${JOB_STATUS:-success}" == "failure" ]]; then
  args+=(-H "Priority: high" -H "Tags: warning,squash")
fi

if [[ -n "${RUN_URL:-}" ]]; then
  args+=(-H "Click: ${RUN_URL}")
fi

curl "${args[@]}" "$url"
