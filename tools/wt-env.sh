#!/usr/bin/env bash
# Per-worktree ports and dev database, so parallel agents never collide.
# Usage (inside any checkout):  eval "$(tools/wt-env.sh)"
# treehouse names slots "<repo>-<slot>" (unique_leaf = true); the main checkout gets slot 0.
set -euo pipefail
leaf="$(basename "$(git rev-parse --show-toplevel)")"
slot="${leaf##*-}"
[[ "$slot" =~ ^[0-9]+$ ]] || slot=0
echo "export WT_SLOT=$slot"
# A port another program already holds (e.g. 5390, 5440 on the dev server) moves to the next free one in the slot's block of 10.
free_port() { local p=$1; while ss -ltnH "sport = :$p" 2>/dev/null | grep -q .; do p=$((p + 1)); done; echo "$p"; }
echo "export PORT=$(free_port $((4100 + slot * 10)))"        # Express API (3000/5173 are taken on the dev server)
echo "export VITE_PORT=$(free_port $((5300 + slot * 10)))"   # Vite dev server (proxies /api to \$PORT)
echo "export MONGODB_DB=finance_wt$slot"        # overrides the database name in MONGODB_URI
