#!/usr/bin/env bash
# Deploy the current checkout to Vercel with the CLI (the repo is not Git-connected to Vercel).
# Usage: tools/deploy.sh staging|production   → prints the deployment URL
# Reads VERCEL_ORG_ID / VERCEL_PROJECT_ID_{PROD,STAGING} from server/.env (seeded into worktrees by treehouse).
set -euo pipefail
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
npx -y vercel@latest deploy --prod --yes 2>&1 | tee /dev/stderr | grep -Eo 'https://[^ ]+\.vercel\.app' | tail -1
