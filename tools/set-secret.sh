#!/usr/bin/env bash
# Paste secrets without them ever being shown or logged.
# Usage: tools/set-secret.sh KEY [KEY...]   e.g. tools/set-secret.sh TELEGRAM_BOT_TOKEN ZALO_BOT_TOKEN
# For each KEY: hidden prompt → written to server/.env → pushed to both Vercel projects (staging + production).
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
env_file="$root/server/.env"
get() { grep -E "^$1=" "$env_file" | head -1 | cut -d= -f2-; }

for key in "$@"; do
  printf '\nPaste %s (hidden, then Enter; empty = skip): ' "$key"
  IFS= read -rs value; echo
  value="$(printf '%s' "$value" | tr -d '[:space:]')"
  if [ -z "$value" ]; then echo "  skipped $key"; continue; fi
  if [ "$key" = "MONGODB_PASSWORD" ]; then
    # Put the (percent-encoded) password into MONGODB_URI instead of storing it separately.
    enc="$(MONGO_PW="$value" python3 -I -c 'import os,urllib.parse;print(urllib.parse.quote(os.environ["MONGO_PW"],safe=""))')"
    uri="$(get MONGODB_URI)"
    new_uri="$(URI="$uri" PW="$enc" python3 -I -c 'import os,re;print(re.sub(r"^(mongodb\+srv://[^:]+:)[^@]*(@)",lambda m:m.group(1)+os.environ["PW"]+m.group(2),os.environ["URI"],count=1))')"
    key=MONGODB_URI; value="$new_uri"
  fi
  tmp="$(mktemp)"; chmod 600 "$tmp"
  if grep -qE "^$key=" "$env_file"; then
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' "$env_file" > "$tmp"
  else
    cat "$env_file" > "$tmp"; printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  cat "$tmp" > "$env_file"; rm -f "$tmp"
  echo "  saved $key to server/.env (${#value} chars)"
  for target in STAGING PROD; do
    VERCEL_ORG_ID="$(get VERCEL_ORG_ID)" VERCEL_PROJECT_ID="$(get "VERCEL_PROJECT_ID_$target")" \
      npx -y vercel@latest env rm "$key" production --yes >/dev/null 2>&1 || true
    printf '%s' "$value" | VERCEL_ORG_ID="$(get VERCEL_ORG_ID)" VERCEL_PROJECT_ID="$(get "VERCEL_PROJECT_ID_$target")" \
      npx -y vercel@latest env add "$key" production >/dev/null 2>&1 && echo "  pushed $key to Vercel ($target)"
  done
done
echo; echo "Done. You can close this tab."
