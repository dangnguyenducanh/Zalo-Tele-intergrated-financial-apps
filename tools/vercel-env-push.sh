#!/usr/bin/env bash
# Copy server/.env into a Vercel project's Production environment variables.
# Usage: tools/vercel-env-push.sh staging|production
# Values are piped through stdin and NEVER printed; only key names are shown.
set -euo pipefail
target="${1:?usage: tools/vercel-env-push.sh staging|production}"
root="$(git rev-parse --show-toplevel)"
env_file="$root/server/.env"
get() { grep -E "^$1=" "$env_file" | head -1 | cut -d= -f2-; }
export VERCEL_ORG_ID="$(get VERCEL_ORG_ID)"
case "$target" in
  staging)    export VERCEL_PROJECT_ID="$(get VERCEL_PROJECT_ID_STAGING)"; app_url="$(get STAGING_URL)"; db=finance_staging ;;
  production) export VERCEL_PROJECT_ID="$(get VERCEL_PROJECT_ID_PROD)";    app_url="$(get PROD_URL)";    db=finance ;;
  *) echo "usage: tools/vercel-env-push.sh staging|production" >&2; exit 2 ;;
esac

# Local-only keys that must not go to Vercel (or get a per-target value below).
skip='^(VERCEL_|SEED_|TEST_USER_|PROD_URL|STAGING_URL|APP_URL|MONGODB_DB|PORT|VITE_PORT|WT_SLOT|KIE_URL|KIE_PUBLIC_URL)'

push() { # key value
  [ -n "$2" ] || { echo "  skip $1 (empty)"; return; }
  case "$2" in *PASTE_*) echo "  skip $1 (not filled in yet)"; return ;; esac
  npx -y vercel@latest env rm "$1" production --yes >/dev/null 2>&1 || true
  printf '%s' "$2" | npx -y vercel@latest env add "$1" production >/dev/null 2>&1
  echo "  set  $1"
}

echo "Pushing env to Vercel ($target):"
while IFS='=' read -r key val; do
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  [[ "$key" =~ $skip ]] && continue
  push "$key" "$val"
done < "$env_file"
push APP_URL "$app_url"
push MONGODB_DB "$db"
push KIE_URL "$(get KIE_PUBLIC_URL)"
echo "Done. Redeploy (tools/deploy.sh $target) for the new values to take effect."
