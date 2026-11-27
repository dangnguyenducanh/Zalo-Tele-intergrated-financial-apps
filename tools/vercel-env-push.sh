#!/usr/bin/env bash
# Copy server/.env into a Vercel project's Production environment variables.
# Usage: tools/vercel-env-push.sh staging|production [KEY...]
#        tools/vercel-env-push.sh staging|production --remove KEY...
#   With no KEY: push every key (plus the per-target APP_URL, MONGODB_DB, KIE_URL, and on production AGENT_URL).
#   With KEYs: push only those (tools/set-secret.sh uses this after saving a secret).
#   With --remove: delete those variables from that Vercel project. server/.env is not read for them or changed,
#   so a key that is only in the dashboard (the GMAIL_* pair, docs/06 §6.14) is removed just the same.
# Values are piped through stdin and NEVER printed or put on a command line; only key names are shown.
set -euo pipefail
usage() {
  cat <<'USAGE'
Usage: tools/vercel-env-push.sh staging|production [KEY...]
       tools/vercel-env-push.sh staging|production --remove KEY...

Without a KEY, copies every variable of server/.env to that Vercel project's Production environment; with KEYs, only those.
With --remove, deletes the named variables from that project (they need not be in server/.env). Redeploy afterwards:
tools/deploy.sh staging|production. Values are never printed.
USAGE
}
case "${1:-}" in -h | --help) usage; exit 0 ;; esac
target="${1:?usage: tools/vercel-env-push.sh staging|production [KEY...] | --remove KEY...}"
shift
remove=0
if [ "${1:-}" = "--remove" ]; then
  remove=1; shift
  [ $# -gt 0 ] || { usage >&2; exit 2; }
fi
# Every argument left is a key, in both modes: a misplaced or misspelled --remove is refused, never pushed as a key.
for key in "$@"; do [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "bad key name: $key" >&2; usage >&2; exit 2; }; done
root="$(git rev-parse --show-toplevel)"
env_file="$root/server/.env"
# The pinned Vercel CLI, from its one definition in tools/deploy.sh.
VERCEL_CLI="$(sed -n 's/^VERCEL_CLI="\(.*\)"$/\1/p' "$root/tools/deploy.sh")"
[ -n "$VERCEL_CLI" ] || { echo "VERCEL_CLI not found in tools/deploy.sh" >&2; exit 1; }
# A value exactly as Node's --env-file reads it (what the local server sees), so Vercel gets the same thing:
# quoted → the text inside the quotes; unquoted → cut at '#' (a comment) and trimmed.
envval() {
  local v="$1" q
  v="${v#"${v%%[![:space:]]*}"}"; q="${v:0:1}"
  if [[ "$q" == [\"\'\`] && "${v:1}" == *"$q"* ]]; then v="${v:1}"; printf '%s' "${v%%"$q"*}"; return; fi
  v="${v%%#*}"; printf '%s' "${v%"${v##*[![:space:]]}"}"
}
get() { envval "$(grep -E "^$1=" "$env_file" | head -1 | cut -d= -f2- || true)"; }
export VERCEL_ORG_ID="$(get VERCEL_ORG_ID)"
case "$target" in
  staging)    export VERCEL_PROJECT_ID="$(get VERCEL_PROJECT_ID_STAGING)"; app_url="$(get STAGING_URL)"; db=finance_staging ;;
  production) export VERCEL_PROJECT_ID="$(get VERCEL_PROJECT_ID_PROD)";    app_url="$(get PROD_URL)";    db=finance ;;
  *) usage >&2; exit 2 ;;
esac

if [ "$remove" = 1 ]; then
  [ -n "$VERCEL_ORG_ID" ] && [ -n "$VERCEL_PROJECT_ID" ] || { echo "VERCEL_ORG_ID or the $target project ID is missing from server/.env. Add it, then Retry: tools/vercel-env-push.sh $target --remove $*" >&2; exit 1; }
  echo "Removing env from Vercel ($target):"
  failed_keys=()
  for key in "$@"; do
    # </dev/null: a prompt (it should not happen with --confirm-name) fails the key instead of hanging the script.
    if npx -y "$VERCEL_CLI" env rm "$key" --environment production --confirm-name "$key" </dev/null >/dev/null 2>&1; then
      echo "  removed $key"
    else
      echo "  FAILED $key (not removed, or it was not set there)" >&2; failed_keys+=("$key")
    fi
  done
  if [ ${#failed_keys[@]} -gt 0 ]; then
    echo "Some keys FAILED for $target. Retry: tools/vercel-env-push.sh $target --remove ${failed_keys[*]}" >&2
    exit 1
  fi
  echo "Done ($target, $# removed). Redeploy (tools/deploy.sh $target) for it to take effect."
  exit 0
fi

# Local-only keys that must not go to Vercel (or get a per-target value below).
skip='^(VERCEL_|SEED_|TEST_USER_|PROD_URL|STAGING_URL|APP_URL|MONGODB_DB|PORT|VITE_PORT|WT_SLOT|KIE_URL|KIE_PUBLIC_URL|AGENT_URL|AGENT_PUBLIC_URL)'

all=1; only=" $* "
[ $# -eq 0 ] || all=0
wanted() { [ "$all" = 1 ] || [[ "$only" == *" $1 "* ]]; }

# .env.example placeholders look like <db_user> or <openssl rand -hex 24>; tools/set-secret.sh refuses values like that.
placeholder='<[[:lower:][:digit:]_ -]+>'
failed=0; pushed=0
push() { # key value
  [ -n "$2" ] || { echo "  skip $1 (empty)"; return; }
  case "$2" in *PASTE_*) echo "  skip $1 (not filled in yet)"; return ;; esac
  [[ ! "$2" =~ $placeholder ]] || { echo "  skip $1 (still a <placeholder> from .env.example)"; return; }
  # --force overwrites an existing value in one step (newer Vercel CLIs refuse a scripted `env rm` without an
  # extra --confirm-name); the value still travels through stdin, never the command line.
  if printf '%s' "$2" | npx -y "$VERCEL_CLI" env add "$1" production --force --yes >/dev/null 2>&1; then
    echo "  set  $1"; pushed=$((pushed + 1))
  else
    echo "  FAILED $1" >&2; failed=1
  fi
}
# Keys whose Vercel value is computed per target below instead of copied.
derived() { case "$1" in APP_URL | MONGODB_DB | KIE_URL | KIE_PUBLIC_URL | AGENT_URL | AGENT_PUBLIC_URL) return 0 ;; esac; return 1; }

echo "Pushing env to Vercel ($target):"
for k in "$@"; do # a requested key that isn't in server/.env is an error, not a silent no-op
  derived "$k" || grep -qE "^$k=" "$env_file" || { echo "  MISSING $k (not in server/.env)" >&2; failed=1; }
done
while IFS= read -r -u 3 line || [ -n "$line" ]; do
  [[ -z "$line" || "$line" == \#* || "$line" != *=* ]] && continue
  key="${line%%=*}"; val="$(envval "${line#*=}")" # split on the first '=' only, so values may contain '='
  wanted "$key" || continue
  if [[ "$key" =~ $skip ]]; then derived "$key" || [ "$all" = 1 ] || echo "  keep $key local only"; continue; fi
  push "$key" "$val"
done 3< "$env_file"
if wanted APP_URL; then push APP_URL "$app_url"; fi
if wanted MONGODB_DB; then push MONGODB_DB "$db"; fi
# Locally KIE_URL is the local service; Vercel's KIE_URL is the public tunnel, kept in KIE_PUBLIC_URL.
if wanted KIE_URL || wanted KIE_PUBLIC_URL; then
  if [ -z "$(get KIE_PUBLIC_URL)" ]; then
    case "$(get KIE_URL)" in
      *://localhost* | *://127.* | *://0.0.0.0* | *://\[::1\]*) echo "  skip KIE_URL (local address; Vercel needs the tunnel: tools/set-secret.sh KIE_PUBLIC_URL)" ;;
      *) push KIE_URL "$(get KIE_URL)" ;; # older layout: KIE_URL is the tunnel URL itself
    esac
  elif wanted KIE_PUBLIC_URL; then
    push KIE_URL "$(get KIE_PUBLIC_URL)"
  else
    echo "  keep KIE_URL local only (Vercel's KIE_URL comes from KIE_PUBLIC_URL: tools/set-secret.sh KIE_PUBLIC_URL)"
  fi
fi
# Vercel's AGENT_URL is the agent service's public tunnel, kept locally in AGENT_PUBLIC_URL (the same way as KIE_URL). The local
# AGENT_URL, the GPU host's own address, is never sent, not even when AGENT_PUBLIC_URL is empty. Decision D19 (docs/06 §6.13): the agent
# reads the production database, so staging gets AGENT_URL only when it is named: a full push and AGENT_PUBLIC_URL leave it unset.
if wanted AGENT_URL || wanted AGENT_PUBLIC_URL; then
  if [ "$target" = staging ] && [[ "$only" != *" AGENT_URL "* ]]; then
    echo "  keep AGENT_URL unset on staging (the agent reads production's database; decision D19). To set it anyway: tools/vercel-env-push.sh staging AGENT_URL"
  elif [ -z "$(get AGENT_PUBLIC_URL)" ]; then
    echo "  skip AGENT_URL (AGENT_PUBLIC_URL is empty: set it with tools/set-secret.sh AGENT_PUBLIC_URL)"
  else
    push AGENT_URL "$(get AGENT_PUBLIC_URL)"
  fi
fi

[ "$failed" -eq 0 ] || { echo "Some keys FAILED for $target (see above)." >&2; exit 1; }
if [ "$pushed" -eq 0 ]; then echo "Nothing pushed to $target."; else echo "Done ($target, $pushed keys). Redeploy (tools/deploy.sh $target) for them to take effect."; fi
