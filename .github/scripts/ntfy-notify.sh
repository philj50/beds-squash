#!/usr/bin/env bash
# Post to ntfy.sh (or self-hosted). Skips silently if NTFY_TOPIC is unset.
set -euo pipefail

title="${1:?title}"
body="${2:?body}"

if [[ -z "${NTFY_TOPIC:-}" ]]; then
  echo "NTFY_TOPIC not set; skipping notification."
  exit 0
fi

server="${NTFY_SERVER:-https://ntfy.sh}"
server="${server%/}"
url="${server}/${NTFY_TOPIC}"

args=(-sSf -d "$body" -H "Title: ${title}" -H "Tags: squash")

if [[ "${JOB_STATUS:-success}" == "failure" ]]; then
  args+=(-H "Priority: high" -H "Tags: warning,squash")
fi

if [[ -n "${RUN_URL:-}" ]]; then
  args+=(-H "Click: ${RUN_URL}")
fi

if [[ -n "${NTFY_TOKEN:-}" ]]; then
  args+=(-H "Authorization: Bearer ${NTFY_TOKEN}")
fi

curl "${args[@]}" "$url"
