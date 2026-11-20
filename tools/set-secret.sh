#!/usr/bin/env bash
# Paste secrets without them ever being shown, logged or put on a command line.
# Usage: tools/set-secret.sh KEY [KEY...]
#   e.g. tools/set-secret.sh MONGODB_PASSWORD TELEGRAM_BOT_TOKEN ZALO_BOT_TOKEN
# For each KEY: hidden prompt → saved in server/.env. Then the changed keys are pushed to both
# Vercel projects through tools/vercel-env-push.sh, which owns the local-only list and the mappings.
# MONGODB_PASSWORD is special: it is percent-encoded and put into MONGODB_URI.
# Secret values only travel through the environment and stdin (never argv), and are never printed.
set -euo pipefail
[ $# -gt 0 ] || { echo "usage: tools/set-secret.sh KEY [KEY...]  (e.g. MONGODB_PASSWORD TELEGRAM_BOT_TOKEN ZALO_BOT_TOKEN)" >&2; exit 2; }
for key in "$@"; do
  [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "bad key name: $key" >&2; exit 2; }
done
root="$(git rev-parse --show-toplevel)"
env_file="$root/server/.env"
[ -f "$env_file" ] || { echo "server/.env not found" >&2; exit 1; }
get() { grep -E "^$1=" "$env_file" | head -1 | cut -d= -f2- || true; }

tmp=""
# Drop anything still waiting on the terminal (extra pasted lines, or an unfinished last line), so it never
# reaches the next prompt or the shell. -n makes read non-canonical, so a line without Enter is seen too.
# Returns 0 if it threw away anything that wasn't blank.
drain() {
  [ -t 0 ] || return 1
  local junk got=1
  while :; do
    junk=""
    if IFS= read -rs -t 0.2 -n 4096 junk; then [[ "$junk" =~ [^[:space:]] ]] && got=0; continue; fi
    [[ "$junk" =~ [^[:space:]] ]] && got=0 # a partial line read before the timeout
    break
  done
  return $got
}
trap '[ -z "$tmp" ] || rm -f "$tmp"; drain || true' EXIT

# Replace every KEY= line (or append one). Key and value reach awk through ENVIRON, not -v,
# so they are not visible in `ps` and awk does not turn backslashes into escapes.
set_key() { # key value
  tmp="$(mktemp "$env_file.XXXXXX")" # server/.env.* is git-ignored; mktemp creates it with mode 600
  K="$1" V="$2" awk 'BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"] }
    index($0, k "=") == 1 { if (!done) print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }' "$env_file" > "$tmp"
  cat "$tmp" > "$env_file" # keeps server/.env's own mode (600)
  rm -f "$tmp"; tmp=""
}

changed=(); errors=0
for key in "$@"; do
  value=""
  while :; do
    printf '\nPaste %s (hidden, then Enter; "-" = skip): ' "$key"
    if ! IFS= read -rs value; then echo; echo "  input ended before $key was given; stopping here" >&2; errors=1; break 2; fi
    echo
    if drain; then echo "  your paste had more than one line, so nothing was saved: paste $key again as one line"; continue; fi
    value="${value//$'\r'/}"
    value="${value#"${value%%[![:space:]]*}"}" # trim leading whitespace
    value="${value%"${value##*[![:space:]]}"}" # trim trailing whitespace
    if [ -z "$value" ]; then echo "  (nothing pasted: paste it again, or type - to skip)"; continue; fi
    [ "$value" = "-" ] || [ "$key" = "MONGODB_PASSWORD" ] || case "$value" in
      # Node's --env-file parser cuts an unquoted value at '#' and strips surrounding quotes,
      # so such a value would differ between the local server and Vercel.
      *'#'* | \'* | \"* | \`*) echo "  rejected: a value with '#' or a leading quote can't be stored in server/.env; use another value" >&2; continue ;;
    esac
    # tools/vercel-env-push.sh skips values holding an .env.example-style <placeholder>, so refuse those for keys it
    # pushes as typed. MONGODB_PASSWORD is pushed percent-encoded (it can't match), and SEED_/TEST_USER_/VERCEL_
    # keys stay local, so for those only a whole-value placeholder is refused.
    case "$key" in
      MONGODB_PASSWORD | SEED_* | TEST_USER_* | VERCEL_*) ph='^<[[:lower:][:digit:]_ -]+>$' ;;
      *) ph='<[[:lower:][:digit:]_ -]+>' ;;
    esac
    if [[ "$value" =~ $ph ]]; then echo "  rejected: that looks like a <placeholder> from .env.example; paste the real value" >&2; continue; fi
    break
  done
  if [ "$value" = "-" ]; then echo "  skipped $key"; continue; fi

  if [ "$key" = "MONGODB_PASSWORD" ]; then
    uri="$(get MONGODB_URI)"
    if [ -z "$uri" ]; then echo "  MONGODB_URI is missing from server/.env; password not saved" >&2; errors=1; continue; fi
    if ! value="$(URI="$uri" PW="$value" python3 -I -c '
import os, re, sys, urllib.parse
pw = urllib.parse.quote(os.environ["PW"], safe="")
uri, n = re.subn(r"^(mongodb(?:\+srv)?://[^:/@]+:)[^@]*(@)", lambda m: m.group(1) + pw + m.group(2), os.environ["URI"], count=1)
sys.exit(3) if n != 1 else print(uri)')"; then
      echo "  MONGODB_URI is not mongodb+srv://<user>:<password>@<host>/...; password not saved" >&2; errors=1; continue
    fi
    key=MONGODB_URI
  fi

  set_key "$key" "$value"
  echo "  saved $key to server/.env (${#value} chars)"
  changed+=("$key")
done

failed=0
if [ ${#changed[@]} -gt 0 ]; then
  for target in staging production; do
    "$root/tools/vercel-env-push.sh" "$target" "${changed[@]}" || failed=1
  done
fi
echo
if [ "$failed" -ne 0 ]; then
  echo "Saved in server/.env, but some Vercel pushes FAILED. Retry with:" >&2
  echo "  tools/vercel-env-push.sh staging ${changed[*]}" >&2
  echo "  tools/vercel-env-push.sh production ${changed[*]}" >&2
  exit 1
fi
[ ${#changed[@]} -gt 0 ] && echo "Saved: ${changed[*]} (Vercel got the ones it uses). Redeploy (tools/deploy.sh) for them to take effect." || echo "Nothing changed."
[ "$errors" -eq 0 ] || { echo "Some keys were NOT saved (see above)." >&2; exit 1; }
echo "You can close this tab."
