#!/usr/bin/env bash
# Deploy the current checkout to Vercel with the CLI (the repo is not Git-connected to Vercel).
# Usage: tools/deploy.sh staging|production   → prints the deployment URL
# Reads VERCEL_ORG_ID / VERCEL_PROJECT_ID_{PROD,STAGING} from server/.env (seeded into worktrees by treehouse).
set -euo pipefail
# The one place the Vercel CLI version is pinned (tools/vercel-env-push.sh reads this line), so a new CLI release
# cannot change a deploy without a change in the repo. 66.6.0 deployed 470ad5a to staging and production.
VERCEL_CLI="vercel@66.6.0"
target="${1:?usage: tools/deploy.sh staging|production}"
root="$(git rev-parse --show-toplevel)"
env_file="$root/server/.env"
get() { grep -E "^$1=" "$env_file" | head -1 | cut -d= -f2-; }
export VERCEL_ORG_ID="$(get VERCEL_ORG_ID)"
case "$target" in
  staging)    export VERCEL_PROJECT_ID="$(get VERCEL_PROJECT_ID_STAGING)" ;;
  production) export VERCEL_PROJECT_ID="$(get VERCEL_PROJECT_ID_PROD)" ;;
  *) echo "usage: tools/deploy.sh staging|production" >&2; exit 2 ;;
esac
cd "$root"
# --prod promotes to the project's main domain (sochitieu-btl[-staging].vercel.app)
npx -y "$VERCEL_CLI" deploy --prod --yes 2>&1 | tee /dev/stderr | grep -Eo 'https://[^ ]+\.vercel\.app' | tail -1
