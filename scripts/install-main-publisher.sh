#!/usr/bin/env bash
set -euo pipefail

app_dir="${APP_DIR:-$HOME/migrated-compose/sverigeklattraren}"
repo_dir="$app_dir/repository"
service_name="sverigeklattraren-publisher"

test -d "$repo_dir/.git"
test -f "$repo_dir/scripts/publish-main.sh"
test -f "$repo_dir/deploy/$service_name.service"
test -f "$repo_dir/deploy/$service_name.timer"

mkdir -p "$app_dir/published/releases" "$app_dir/published/state"
install -m 700 "$repo_dir/scripts/publish-main.sh" "$app_dir/publish-main.sh"

if [[ ! -f "$app_dir/published/state/app-sha" ]]; then
  if ! curl --fail --silent http://127.0.0.1:3086/ >/dev/null; then
    echo "Den befintliga containern måste vara frisk före bootstrap." >&2
    exit 2
  fi
  git -C "$repo_dir" rev-parse main > "$app_dir/published/state/app-sha"
fi
fi

"$app_dir/publish-main.sh"

sudo install -m 644 "$repo_dir/deploy/$service_name.service" "/etc/systemd/system/$service_name.service"
sudo install -m 644 "$repo_dir/deploy/$service_name.timer" "/etc/systemd/system/$service_name.timer"
sudo systemctl daemon-reload
sudo systemctl enable --now "$service_name.timer"
sudo systemctl start "$service_name.service"

echo "Pull-baserad publicering installerad."
sudo systemctl status "$service_name.timer" --no-pager
