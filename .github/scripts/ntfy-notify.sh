#!/usr/bin/env bash
# Post to a public ntfy.sh topic. The topic name is the third argument.
# beds_lm_1234, beds_sl_1234, beds_config_1234, beds_errors_1234,
# beds_juniors_1234, beds_closed_1234 and beds_commentary_1234 are the topics in use.
set -euo pipefail

title="${1:?title}"
body="${2:?body}"
topic="${3:?topic}"

slug=""
case "$topic" in
  beds_config_1234) slug="ntfy-config" ;;
  beds_lm_1234) slug="ntfy-lm" ;;
  beds_sl_1234) slug="ntfy-sl" ;;
  beds_errors_1234) slug="ntfy-errors" ;;
  beds_juniors_1234) slug="ntfy-juniors" ;;
  beds_closed_1234) slug="ntfy-closed" ;;
  beds_commentary_1234) slug="ntfy-commentary" ;;
esac

if [[ -n "$slug" ]]; then
  rule="$(curl -fsS "https://klxyjmwiaivvqjbhxzak.supabase.co/rest/v1/ntfy_rules?slug=eq.${slug}&select=enabled" \
    -H "apikey: sb_publishable_wcOU09VyQcF7JWoZ6i-PHg_pFp6UM-4" \
    -H "Authorization: Bearer sb_publishable_wcOU09VyQcF7JWoZ6i-PHg_pFp6UM-4" || true)"
  if [[ "$rule" == *'"enabled":false'* || "$rule" == *'"enabled": false'* ]]; then
    echo "ntfy ${topic} is switched off."
    exit 0
  fi
fi

url="https://ntfy.sh/${topic}"

args=(-sSf -d "$body" -H "Title: ${title}" -H "Tags: squash")

if [[ "${JOB_STATUS:-success}" == "failure" ]]; then
  args+=(-H "Priority: high" -H "Tags: warning,squash")
fi

if [[ -n "${RUN_URL:-}" ]]; then
  args+=(-H "Click: ${RUN_URL}")
fi

curl "${args[@]}" "$url"
