#!/usr/bin/env bash
# Per-worktree ports and dev database, so parallel agents never collide.
# Usage (inside any checkout):  eval "$(tools/wt-env.sh)"
# treehouse names slots "<repo>-<slot>" (unique_leaf = true); the main checkout gets slot 0.
set -euo pipefail
leaf="$(basename "$(git rev-parse --show-toplevel)")"
slot="${leaf##*-}"
[[ "$slot" =~ ^[0-9]+$ ]] || slot=0
echo "export WT_SLOT=$slot"
echo "export PORT=$((4100 + slot * 10))"        # Express API (3000/5173 are taken on the dev server)
echo "export VITE_PORT=$((5300 + slot * 10))"   # Vite dev server (proxies /api to \$PORT)
echo "export MONGODB_DB=finance_wt$slot"        # overrides the database name in MONGODB_URI
