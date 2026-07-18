#!/usr/bin/env bash
set -euo pipefail

image_ref="${1:-}"
if [[ ! "$image_ref" =~ ^ghcr\.io/nicemd/sverigeklattraren:[0-9a-f]{40}$ ]]; then
  echo "Ogiltig image-referens." >&2
  exit 2
fi

app_dir="$HOME/migrated-compose/sverigeklattraren"
repo_dir="$app_dir/repository"
env_file="$app_dir/.env"

test -d "$repo_dir/.git"
test -f "$env_file"

cd "$repo_dir"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Serverrepot har lokala arbetskopieändringar; avbryter utan att skriva över dem." >&2
  exit 3
fi

git fetch origin main
local_ahead="$(git rev-list --count origin/main..main)"
if [[ "$local_ahead" != "0" ]]; then
  echo "Serverrepot har $local_ahead opushade commits; migrera dem till Pull Requests först." >&2
  exit 4
fi

git checkout main
git pull --ff-only origin main
cp "$repo_dir/docker-compose.yml" "$app_dir/docker-compose.yml"

next_env="$app_dir/.env.next"
awk -v image="$image_ref" '
  BEGIN { replaced = 0 }
  /^GHCR_IMAGE=/ { print "GHCR_IMAGE=" image; replaced = 1; next }
  { print }
  END { if (!replaced) print "GHCR_IMAGE=" image }
' "$env_file" > "$next_env"
chmod 600 "$next_env"
mv "$next_env" "$env_file"

cd "$app_dir"
sudo docker-compose pull
sudo docker-compose up -d --force-recreate --no-build

for attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:3086/ >/dev/null; then
    echo "Sverigeklättraren är publicerad från $image_ref"
    sudo docker-compose ps
    exit 0
  fi
  if [[ "$attempt" -eq 30 ]]; then
    echo "Hälsokontrollen misslyckades efter deploy." >&2
    sudo docker-compose ps >&2
    exit 5
  fi
  sleep 2
done
