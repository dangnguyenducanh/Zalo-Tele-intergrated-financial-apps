#!/usr/bin/env bash
# Copy server/.env into a Vercel project's Production environment variables.
# Usage: tools/vercel-env-push.sh staging|production [KEY...]
#   With no KEY: push every key (plus the per-target APP_URL, MONGODB_DB, KIE_URL).
#   With KEYs: push only those (tools/set-secret.sh uses this after saving a secret).
# Values are piped through stdin and NEVER printed or put on a command line; only key names are shown.
set -euo pipefail
target="${1:?usage: tools/vercel-env-push.sh staging|production [KEY...]}"
shift
root="$(git rev-parse --show-toplevel)"
env_file="$root/server/.env"
get() { grep -E "^$1=" "$env_file" | head -1 | cut -d= -f2- || true; }
export VERCEL_ORG_ID="$(get VERCEL_ORG_ID)"
case "$target" in
  staging)    export VERCEL_PROJECT_ID="$(get VERCEL_PROJECT_ID_STAGING)"; app_url="$(get STAGING_URL)"; db=finance_staging ;;
  production) export VERCEL_PROJECT_ID="$(get VERCEL_PROJECT_ID_PROD)";    app_url="$(get PROD_URL)";    db=finance ;;
  *) echo "usage: tools/vercel-env-push.sh staging|production [KEY...]" >&2; exit 2 ;;
esac

# Local-only keys that must not go to Vercel (or get a per-target value below).
skip='^(VERCEL_|SEED_|TEST_USER_|PROD_URL|STAGING_URL|APP_URL|MONGODB_DB|PORT|VITE_PORT|WT_SLOT|KIE_URL|KIE_PUBLIC_URL)'

all=1; only=" $* "
[ $# -eq 0 ] || all=0
wanted() { [ "$all" = 1 ] || [[ "$only" == *" $1 "* ]]; }

failed=0; pushed=0
push() { # key value
  [ -n "$2" ] || { echo "  skip $1 (empty)"; return; }
  case "$2" in *PASTE_*) echo "  skip $1 (not filled in yet)"; return ;; esac
  npx -y vercel@latest env rm "$1" production --yes </dev/null >/dev/null 2>&1 || true
  if printf '%s' "$2" | npx -y vercel@latest env add "$1" production >/dev/null 2>&1; then
    echo "  set  $1"; pushed=$((pushed + 1))
  else
    echo "  FAILED $1" >&2; failed=1
  fi
}
# Keys whose Vercel value is computed per target below instead of copied.
derived() { case "$1" in APP_URL | MONGODB_DB | KIE_URL | KIE_PUBLIC_URL) return 0 ;; esac; return 1; }

echo "Pushing env to Vercel ($target):"
for k in "$@"; do # a requested key that isn't in server/.env is an error, not a silent no-op
  derived "$k" || grep -qE "^$k=" "$env_file" || { echo "  MISSING $k (not in server/.env)" >&2; failed=1; }
done
while IFS= read -r -u 3 line || [ -n "$line" ]; do
  [[ -z "$line" || "$line" == \#* || "$line" != *=* ]] && continue
  key="${line%%=*}"; val="${line#*=}" # split on the first '=' only, so values may contain '='
  wanted "$key" || continue
  if [[ "$key" =~ $skip ]]; then derived "$key" || [ "$all" = 1 ] || echo "  keep $key local only"; continue; fi
  push "$key" "$val"
done 3< "$env_file"
if wanted APP_URL; then push APP_URL "$app_url"; fi
if wanted MONGODB_DB; then push MONGODB_DB "$db"; fi
if wanted KIE_URL || wanted KIE_PUBLIC_URL; then push KIE_URL "$(get KIE_PUBLIC_URL)"; fi # Vercel reaches KIE through the public tunnel

[ "$failed" -eq 0 ] || { echo "Some keys FAILED for $target (see above)." >&2; exit 1; }
if [ "$pushed" -eq 0 ]; then echo "Nothing pushed to $target."; else echo "Done ($target, $pushed keys). Redeploy (tools/deploy.sh $target) for them to take effect."; fi
